import { kea, props, path, key, actions, reducers, selectors, listeners, connect } from 'kea'
import { loaders } from 'kea-loaders'
import api from 'lib/api'
import { toParams } from 'lib/utils'
import {
    sessionRecordingPlayerLogic,
    SessionRecordingPlayerLogicProps,
} from 'scenes/session-recordings/player/sessionRecordingPlayerLogic'

import type { playlistPopupLogicType } from './playlistPopupLogicType'
import { SessionRecordingPlaylistType } from '~/types'
import { forms } from 'kea-forms'
import { sessionRecordingsListLogic } from 'scenes/session-recordings/playlist/sessionRecordingsListLogic'
import { addRecordingToPlaylist, removeRecordingFromPlaylist } from 'scenes/session-recordings/player/playerUtils'
import { createPlaylist } from 'scenes/session-recordings/playlist/playlistUtils'
import { eventUsageLogic } from 'lib/utils/eventUsageLogic'

export const playlistPopupLogic = kea<playlistPopupLogicType>([
    path((key) => ['scenes', 'session-recordings', 'player', 'playlist-popup', 'playlistPopupLogic', key]),
    props({} as SessionRecordingPlayerLogicProps),
    key((props: SessionRecordingPlayerLogicProps) => `${props.playerKey}-${props.sessionRecordingId}`),
    connect((props: SessionRecordingPlayerLogicProps) => ({
        actions: [
            sessionRecordingPlayerLogic(props),
            ['setPause'],
            eventUsageLogic,
            ['reportRecordingPinnedToList', 'reportRecordingPlaylistCreated'],
        ],
    })),
    actions(() => ({
        setSearchQuery: (query: string) => ({ query }),
        loadPlaylists: true,
        loadPlaylistsForRecording: true,
        addToPlaylist: (playlist: SessionRecordingPlaylistType) => ({ playlist }),
        removeFromPlaylist: (playlist: SessionRecordingPlaylistType) => ({ playlist }),
        setNewFormShowing: (show: boolean) => ({ show }),
        setShowPlaylistPopup: (show: boolean) => ({ show }),
    })),
    loaders(({ values, props, actions }) => ({
        playlists: {
            __default: [] as SessionRecordingPlaylistType[],
            loadPlaylists: async (_, breakpoint) => {
                await breakpoint(300)
                const response = await api.recordings.listPlaylists(toParams({ search: values.searchQuery }))
                breakpoint()
                return response.results
            },
        },
        currentPlaylists: {
            __default: [] as SessionRecordingPlaylistType[],
            loadPlaylistsForRecording: async (_, breakpoint) => {
                await breakpoint(300)
                const response = await api.recordings.listPlaylists(
                    toParams({ session_recording_id: props.sessionRecordingId })
                )
                breakpoint()
                return response.results
            },

            addToPlaylist: async ({ playlist }) => {
                await addRecordingToPlaylist(playlist.short_id, props.sessionRecordingId, true)
                actions.reportRecordingPinnedToList(true)
                return [playlist, ...values.currentPlaylists]
            },

            removeFromPlaylist: async ({ playlist }) => {
                await removeRecordingFromPlaylist(playlist.short_id, props.sessionRecordingId, true)
                actions.reportRecordingPinnedToList(false)
                return values.currentPlaylists.filter((x) => x.short_id !== playlist.short_id)
            },
        },
    })),
    reducers(() => ({
        searchQuery: ['', { setSearchQuery: (_, { query }) => query }],
        newFormShowing: [
            false,
            {
                setNewFormShowing: (_, { show }) => show,
            },
        ],
        showPlaylistPopup: [
            false,
            {
                setShowPlaylistPopup: (_, { show }) => show,
            },
        ],
        modifiyingPlaylist: [
            null as SessionRecordingPlaylistType | null,
            {
                addToPlaylist: (_, { playlist }) => playlist,
                removeFromPlaylist: (_, { playlist }) => playlist,
                setShowPlaylistPopup: () => null,
            },
        ],
    })),
    forms(({ actions }) => ({
        newPlaylist: {
            defaults: { name: '' },
            errors: ({ name }) => ({
                name: !name ? 'Required' : null,
            }),
            submit: async ({ name }, breakpoint) => {
                await breakpoint(100)
                const newPlaylist = await createPlaylist({
                    name,
                })

                actions.reportRecordingPlaylistCreated('pin')

                if (!newPlaylist) {
                    // This indicates the billing popup has been shown so we should close the modal
                    actions.setShowPlaylistPopup(false)
                    return
                }

                actions.addToPlaylist(newPlaylist)
                actions.setNewFormShowing(false)
                actions.resetNewPlaylist()
                actions.setSearchQuery('')
            },
        },
    })),
    listeners(({ actions, values }) => ({
        setSearchQuery: () => {
            actions.loadPlaylists()
        },
        setNewFormShowing: ({ show }) => {
            if (show) {
                actions.setNewPlaylistValue('name', values.searchQuery)
            }
        },

        setShowPlaylistPopup: ({ show }) => {
            if (show) {
                actions.loadPlaylists()
                actions.loadPlaylistsForRecording()
                actions.setPause()
            }
        },
        addToPlaylistSuccess: ({ payload }) => {
            if (payload?.playlist.short_id) {
                sessionRecordingsListLogic
                    .findMounted({ playlistShortId: payload?.playlist.short_id })
                    ?.actions.loadPinnedRecordings({})
            }
        },
        removeFromPlaylistSuccess: ({ payload }) => {
            if (payload?.playlist.short_id) {
                // TODO: Change this around for the list logic to listen out for the player changing it
                // or at least that it doesn't trigger a load...
                sessionRecordingsListLogic
                    .findMounted({ playlistShortId: payload?.playlist.short_id })
                    ?.actions.loadPinnedRecordings({})
            }
        },
    })),
    selectors(() => ({
        allPlaylists: [
            (s) => [s.playlists, s.currentPlaylists, s.searchQuery, (_, props) => props.playlistShortId],
            (playlists, currentPlaylists, searchQuery, playlistShortId) => {
                const otherPlaylists = searchQuery
                    ? playlists
                    : playlists.filter((x) => !currentPlaylists.find((y) => x.short_id === y.short_id))

                const selectedPlaylists = !searchQuery ? currentPlaylists : []

                let results: {
                    selected: boolean
                    playlist: SessionRecordingPlaylistType
                }[] = [
                    ...selectedPlaylists.map((x) => ({
                        selected: true,
                        playlist: x,
                    })),
                    ...otherPlaylists.map((x) => ({
                        selected: !!currentPlaylists.find((y) => x.short_id === y.short_id),
                        playlist: x,
                    })),
                ]

                // If props.playlistShortId exists put it at the beginning of the list
                if (playlistShortId) {
                    results = results.sort((a, b) =>
                        a.playlist.short_id == playlistShortId ? -1 : b.playlist.short_id == playlistShortId ? 1 : 0
                    )
                }

                return results
            },
        ],
    })),
])
