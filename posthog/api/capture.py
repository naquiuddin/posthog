import hashlib
import json
import re
import time
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Tuple

import structlog
from dateutil import parser
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from kafka.errors import KafkaError
from kafka.producer.future import FutureRecordMetadata
from rest_framework import status
from sentry_sdk import configure_scope
from sentry_sdk.api import capture_exception, start_span
from statshog.defaults.django import statsd

from posthog.api.utils import (
    EventIngestionContext,
    get_data,
    get_event_ingestion_context,
    get_token,
    safe_clickhouse_string,
)
from posthog.exceptions import generate_exception_response
from posthog.helpers.session_recording import preprocess_session_recording_events_for_clickhouse
from posthog.kafka_client.client import KafkaProducer
from posthog.kafka_client.topics import KAFKA_DEAD_LETTER_QUEUE
from posthog.logging.timing import timed
from posthog.models.feature_flag import get_all_feature_flags
from posthog.models.utils import UUIDT
from posthog.settings import KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC
from posthog.utils import cors_response, get_ip_address

logger = structlog.get_logger(__name__)


def parse_kafka_event_data(
    distinct_id: str,
    ip: Optional[str],
    site_url: str,
    data: Dict,
    team_id: Optional[int],
    now: datetime,
    sent_at: Optional[datetime],
    event_uuid: UUIDT,
    token: str,
) -> Dict:
    logger.debug("parse_kafka_event_data", token=token, team_id=team_id)
    return {
        "uuid": str(event_uuid),
        "distinct_id": safe_clickhouse_string(distinct_id),
        "ip": safe_clickhouse_string(ip) if ip else ip,
        "site_url": safe_clickhouse_string(site_url),
        "data": json.dumps(data),
        "team_id": team_id,
        "now": now.isoformat(),
        "sent_at": sent_at.isoformat() if sent_at else "",
        "token": token,
    }


def log_event(data: Dict, event_name: str, partition_key: Optional[str]):
    logger.debug("logging_event", event_name=event_name, kafka_topic=KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC)

    # TODO: Handle Kafka being unavailable with exponential backoff retries
    try:
        future = KafkaProducer().produce(topic=KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC, data=data, key=partition_key)
        statsd.incr("posthog_cloud_plugin_server_ingestion")
        return future
    except Exception as e:
        statsd.incr("capture_endpoint_log_event_error")
        print(f"Failed to produce event to Kafka topic {KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC} with error:", e)
        raise e


def log_event_to_dead_letter_queue(
    raw_payload: Dict,
    event_name: str,
    event: Dict,
    error_message: str,
    error_location: str,
    topic: str = KAFKA_DEAD_LETTER_QUEUE,
):
    data = event.copy()

    data["error_timestamp"] = datetime.now().isoformat()
    data["error_location"] = safe_clickhouse_string(error_location)
    data["error"] = safe_clickhouse_string(error_message)
    data["elements_chain"] = ""
    data["id"] = str(UUIDT())
    data["event"] = safe_clickhouse_string(event_name)
    data["raw_payload"] = json.dumps(raw_payload)
    data["now"] = datetime.fromisoformat(data["now"]).replace(tzinfo=None).isoformat() if data["now"] else None
    data["tags"] = ["django_server"]
    data["event_uuid"] = event["uuid"]
    del data["uuid"]

    try:
        KafkaProducer().produce(topic=topic, data=data)
        statsd.incr(settings.EVENTS_DEAD_LETTER_QUEUE_STATSD_METRIC)
    except Exception as e:
        capture_exception(e)
        statsd.incr("events_dead_letter_queue_produce_error")

        if settings.DEBUG:
            print("Failed to produce to events dead letter queue with error:", e)


def _datetime_from_seconds_or_millis(timestamp: str) -> datetime:
    if len(timestamp) > 11:  # assuming milliseconds / update "11" to "12" if year > 5138 (set a reminder!)
        timestamp_number = float(timestamp) / 1000
    else:
        timestamp_number = int(timestamp)

    return datetime.fromtimestamp(timestamp_number, timezone.utc)


def _get_sent_at(data, request) -> Tuple[Optional[datetime], Any]:
    try:
        if request.GET.get("_"):  # posthog-js
            sent_at = request.GET["_"]
        elif isinstance(data, dict) and data.get("sent_at"):  # posthog-android, posthog-ios
            sent_at = data["sent_at"]
        elif request.POST.get("sent_at"):  # when urlencoded body and not JSON (in some test)
            sent_at = request.POST["sent_at"]
        else:
            return None, None

        if re.match(r"^\d+(?:\.\d+)?$", sent_at):
            return _datetime_from_seconds_or_millis(sent_at), None

        return parser.isoparse(sent_at), None
    except Exception as error:
        statsd.incr("capture_endpoint_invalid_sent_at")
        logger.exception(f"Invalid sent_at value", error=error)
        return (
            None,
            cors_response(
                request,
                generate_exception_response(
                    "capture", f"Malformed request data, invalid sent at: {error}", code="invalid_payload"
                ),
            ),
        )


def get_distinct_id(data: Dict[str, Any]) -> str:
    raw_value: Any = ""
    try:
        raw_value = data["$distinct_id"]
    except KeyError:
        try:
            raw_value = data["properties"]["distinct_id"]
        except KeyError:
            try:
                raw_value = data["distinct_id"]
            except KeyError:
                statsd.incr("invalid_event", tags={"error": "missing_distinct_id"})
                raise ValueError('All events must have the event field "distinct_id"!')
        except TypeError:
            raise ValueError(f'Properties must be a JSON object, received {type(data["properties"]).__name__}!')
    if not raw_value:
        statsd.incr("invalid_event", tags={"error": "invalid_distinct_id"})
        raise ValueError('Event field "distinct_id" should not be blank!')
    return str(raw_value)[0:200]


def _ensure_web_feature_flags_in_properties(
    event: Dict[str, Any], ingestion_context: EventIngestionContext, distinct_id: str
):
    """If the event comes from web, ensure that it contains property $active_feature_flags."""
    if event["properties"].get("$lib") == "web" and "$active_feature_flags" not in event["properties"]:
        statsd.incr("active_feature_flags_missing")
        all_flags, _ = get_all_feature_flags(team_id=ingestion_context.team_id, distinct_id=distinct_id)
        active_flags = {key: value for key, value in all_flags.items() if value}
        flag_keys = list(active_flags.keys())
        event["properties"]["$active_feature_flags"] = flag_keys

        if len(flag_keys) > 0:
            statsd.incr("active_feature_flags_added")

            for k, v in active_flags.items():
                event["properties"][f"$feature/{k}"] = v


@csrf_exempt
@timed("posthog_cloud_event_endpoint")
def get_event(request):
    # handle cors request
    if request.method == "OPTIONS":
        return cors_response(request, JsonResponse({"status": 1}))

    now = timezone.now()

    data, error_response = get_data(request)

    if error_response:
        return error_response

    sent_at, error_response = _get_sent_at(data, request)

    if error_response:
        return error_response

    with start_span(op="request.authenticate"):
        token = get_token(data, request)

        if not token:
            return cors_response(
                request,
                generate_exception_response(
                    "capture",
                    "API key not provided. You can find your project API key in PostHog project settings.",
                    type="authentication_error",
                    code="missing_api_key",
                    status_code=status.HTTP_401_UNAUTHORIZED,
                ),
            )

        ingestion_context = None
        send_events_to_dead_letter_queue = False

        if token in settings.LIGHTWEIGHT_CAPTURE_ENDPOINT_ENABLED_TOKENS:
            logger.debug("lightweight_capture_endpoint_hit", token=token)
            statsd.incr("lightweight_capture_endpoint_hit")
        else:
            ingestion_context, db_error, error_response = get_event_ingestion_context(request, data, token)

            if error_response:
                return error_response

            if db_error:
                send_events_to_dead_letter_queue = True

    with start_span(op="request.process"):
        if isinstance(data, dict):
            if data.get("batch"):  # posthog-python and posthog-ruby
                data = data["batch"]
                assert data is not None
            elif "engage" in request.path_info:  # JS identify call
                data["event"] = "$identify"  # make sure it has an event name

        if isinstance(data, list):
            events = data
        else:
            events = [data]

        try:
            events = preprocess_session_recording_events_for_clickhouse(events)
        except ValueError as e:
            return cors_response(
                request, generate_exception_response("capture", f"Invalid payload: {e}", code="invalid_payload")
            )

        site_url = request.build_absolute_uri("/")[:-1]

        ip = None if ingestion_context and ingestion_context.anonymize_ips else get_ip_address(request)

        try:
            processed_events = list(validate_events(events, ingestion_context))
        except ValueError as e:
            return cors_response(
                request, generate_exception_response("capture", f"Invalid payload: {e}", code="invalid_payload")
            )

    futures: List[FutureRecordMetadata] = []

    with start_span(op="kafka.produce") as span:
        span.set_tag("event.count", len(processed_events))
        for event, event_uuid, distinct_id in processed_events:
            if send_events_to_dead_letter_queue:
                kafka_event = parse_kafka_event_data(
                    distinct_id=distinct_id,
                    ip=None,
                    site_url=site_url,
                    team_id=None,
                    now=now,
                    event_uuid=event_uuid,
                    data=event,
                    sent_at=sent_at,
                    token=token,
                )

                log_event_to_dead_letter_queue(
                    data,
                    event["event"],
                    kafka_event,
                    f"Unable to fetch team from Postgres. Error: {db_error}",
                    "django_server_capture_endpoint",
                )
                continue

            team_id = ingestion_context.team_id if ingestion_context else None
            try:
                futures.append(
                    capture_internal(
                        event, distinct_id, ip, site_url, now, sent_at, team_id, event_uuid, token
                    )  # type: ignore
                )
            except Exception as exc:
                capture_exception(exc, {"data": data})
                statsd.incr("posthog_cloud_raw_endpoint_failure", tags={"endpoint": "capture"})
                logger.error("kafka_produce_failure", exc_info=exc)
                return cors_response(
                    request,
                    generate_exception_response(
                        "capture",
                        "Unable to store event. Please try again. If you are the owner of this app you can check the logs for further details.",
                        code="server_error",
                        type="server_error",
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    ),
                )

    with start_span(op="kafka.wait"):
        span.set_tag("future.count", len(futures))
        start_time = time.monotonic()
        for future in futures:
            try:
                future.get(timeout=settings.KAFKA_PRODUCE_ACK_TIMEOUT_SECONDS - (time.monotonic() - start_time))
            except KafkaError as exc:
                # TODO: distinguish between retriable errors and non-retriable
                # errors, and set Retry-After header accordingly.
                # TODO: return 400 error for non-retriable errors that require the
                # client to change their request.
                logger.error("kafka_produce_failure", exc_info=exc)
                return cors_response(
                    request,
                    generate_exception_response(
                        "capture",
                        "Unable to store some events. Please try again. If you are the owner of this app you can check the logs for further details.",
                        code="server_error",
                        type="server_error",
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    ),
                )

    statsd.incr("posthog_cloud_raw_endpoint_success", tags={"endpoint": "capture"})
    return cors_response(request, JsonResponse({"status": 1}))


# TODO: Rename this function - it doesn't just validate events, it also processes them
def validate_events(
    events: List[Dict[str, Any]], ingestion_context: Optional[EventIngestionContext]
) -> Iterator[Tuple[Dict[str, Any], UUIDT, str]]:
    for event in events:
        event_uuid = UUIDT()
        distinct_id = get_distinct_id(event)
        payload_uuid = event.get("uuid", None)
        if payload_uuid:
            if UUIDT.is_valid_uuid(payload_uuid):
                event_uuid = UUIDT(uuid_str=payload_uuid)
            else:
                statsd.incr("invalid_event_uuid")
                raise ValueError('Event field "uuid" is not a valid UUID!')

        event = parse_event(event)
        if not event:
            continue

        if ingestion_context:
            # TODO: Get rid of this code path after informing users about bootstrapping feature flags
            _ensure_web_feature_flags_in_properties(event, ingestion_context, distinct_id)

        yield event, event_uuid, distinct_id


def parse_event(event):
    if not event.get("event"):
        statsd.incr("invalid_event", tags={"error": "missing_event_name"})
        return

    if not event.get("properties"):
        event["properties"] = {}

    with configure_scope() as scope:
        scope.set_tag("library", event["properties"].get("$lib", "unknown"))
        scope.set_tag("library.version", event["properties"].get("$lib_version", "unknown"))

    return event


def capture_internal(event, distinct_id, ip, site_url, now, sent_at, team_id, event_uuid=None, token=None) -> None:
    if event_uuid is None:
        event_uuid = UUIDT()

    parsed_event = parse_kafka_event_data(
        distinct_id=distinct_id,
        ip=ip,
        site_url=site_url,
        data=event,
        team_id=team_id,
        now=now,
        sent_at=sent_at,
        event_uuid=event_uuid,
        token=token,
    )

    # We aim to always partition by {team_id}:{distinct_id} but allow
    # overriding this to deal with hot partitions in specific cases.
    # Setting the partition key to None means using random partitioning.
    kafka_partition_key = None
    candidate_partition_key = f"{team_id}:{distinct_id}"

    if candidate_partition_key not in settings.EVENT_PARTITION_KEYS_TO_OVERRIDE:
        kafka_partition_key = hashlib.sha256(candidate_partition_key.encode()).hexdigest()

    return log_event(parsed_event, event["event"], partition_key=kafka_partition_key)
