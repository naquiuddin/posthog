import { actions, connect, kea, path, reducers, selectors } from 'kea'
import { FEATURE_FLAGS } from 'lib/constants'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { SessionRecordingPlayerTab } from '~/types'

import type { playerSettingsLogicType } from './playerSettingsLogicType'

export type SharedListMiniFilter = {
    tab: SessionRecordingPlayerTab
    key: string
    name: string
    // If alone, then enabling it will disable all the others
    alone?: boolean
    tooltip?: string
    enabled?: boolean
}

const MiniFilters: SharedListMiniFilter[] = [
    {
        tab: SessionRecordingPlayerTab.ALL,
        key: 'all-automatic',
        name: 'Auto',
        alone: true,
        tooltip: 'Curated list of key PostHog events, custom events, error logs etc.',
    },
    {
        tab: SessionRecordingPlayerTab.ALL,
        key: 'all-errors',
        name: 'Errors',
        alone: true,
        tooltip: 'Events containing "error" or "exception" in their name and console errors',
    },
    {
        tab: SessionRecordingPlayerTab.ALL,
        key: 'all-everything',
        name: 'Everything',
        alone: true,
        tooltip: 'Everything that happened in this session',
    },
    {
        tab: SessionRecordingPlayerTab.EVENTS,
        key: 'events-all',
        name: 'All',
        alone: true,
        tooltip: 'All events tracked during this session',
    },
    {
        tab: SessionRecordingPlayerTab.EVENTS,
        key: 'events-posthog',
        name: 'PostHog',
        tooltip: 'Standard PostHog events like Pageviews, Autocapture etc.',
    },
    {
        tab: SessionRecordingPlayerTab.EVENTS,
        key: 'events-custom',
        name: 'Custom',
        tooltip: 'Custom events tracked by your app',
    },
    {
        tab: SessionRecordingPlayerTab.EVENTS,
        key: 'events-pageview',
        name: 'Pageview / Screen',
        tooltip: 'Pageview (or Screen for mobile) events',
    },
    {
        tab: SessionRecordingPlayerTab.EVENTS,
        key: 'events-autocapture',
        name: 'Autocapture',
        tooltip: 'Autocapture events such as clicks and inputs',
    },
    {
        tab: SessionRecordingPlayerTab.CONSOLE,
        key: 'console-all',
        name: 'All',
        alone: true,
    },
    {
        tab: SessionRecordingPlayerTab.CONSOLE,
        key: 'console-info',
        name: 'Info',
    },
    {
        tab: SessionRecordingPlayerTab.CONSOLE,
        key: 'console-warn',
        name: 'Warn',
    },
    {
        tab: SessionRecordingPlayerTab.CONSOLE,
        key: 'console-error',
        name: 'Error',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-all',
        name: 'All',
        alone: true,
        tooltip: 'All network performance information collected during the session',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-document',
        name: 'Document',
        tooltip: 'Page load information collected on a fresh browser page load or a refresh',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-fetch',
        name: 'XHR / Fetch',
        tooltip: 'Requests during the session to external resources like APIs via XHR or Fetch',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-assets',
        name: 'Assets',
        tooltip: 'Assets loaded during the session such as images, CSS and JS',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-other',
        name: 'Other',
        tooltip: 'Any other network requests that do not fall into the other categories',
    },
    {
        tab: SessionRecordingPlayerTab.PERFORMANCE,
        key: 'performance-paint',
        name: 'Paint',
        tooltip: 'Events indicating when the browser has painted the page',
    },
]

// This logic contains player settings that should persist across players
// There is no key for this logic, so it does not reset when recordings change
export const playerSettingsLogic = kea<playerSettingsLogicType>([
    path(['scenes', 'session-recordings', 'player', 'playerSettingsLogic']),
    connect({
        values: [featureFlagLogic, ['featureFlags']],
    }),
    actions({
        setSkipInactivitySetting: (skipInactivitySetting: boolean) => ({ skipInactivitySetting }),
        setSpeed: (speed: number) => ({ speed }),
        setShowOnlyMatching: (showOnlyMatching: boolean) => ({ showOnlyMatching }),
        setIsFullScreen: (isFullScreen: boolean) => ({ isFullScreen }),
        setIsMetadataExpanded: (isMetadataExpanded: boolean) => ({ isMetadataExpanded }),
        setAutoplayEnabled: (enabled: boolean) => ({ enabled }),
        setTab: (tab: SessionRecordingPlayerTab) => ({ tab }),
        setTimestampMode: (mode: 'absolute' | 'relative') => ({ mode }),
        setMiniFilter: (key: string, enabled: boolean) => ({ key, enabled }),
    }),
    reducers(({ values }) => ({
        speed: [
            1,
            { persist: true },
            {
                setSpeed: (_, { speed }) => speed,
            },
        ],
        skipInactivitySetting: [
            true,
            { persist: true },
            {
                setSkipInactivitySetting: (_, { skipInactivitySetting }) => skipInactivitySetting,
            },
        ],
        showOnlyMatching: [
            false,
            { persist: true },
            {
                setShowOnlyMatching: (_, { showOnlyMatching }) => showOnlyMatching,
            },
        ],
        isFullScreen: [
            false,
            {
                setIsFullScreen: (_, { isFullScreen }) => isFullScreen,
            },
        ],
        isMetadataExpanded: [
            false,
            {
                setIsMetadataExpanded: (_, { isMetadataExpanded }) => isMetadataExpanded,
            },
        ],
        autoplayEnabled: [
            true,
            { persist: true },
            {
                setAutoplayEnabled: (_, { enabled }) => enabled,
            },
        ],

        // Inspector
        tab: [
            (values.featureFlags[FEATURE_FLAGS.RECORDINGS_INSPECTOR_V2]
                ? SessionRecordingPlayerTab.ALL
                : SessionRecordingPlayerTab.EVENTS) as SessionRecordingPlayerTab,
            { persist: true },
            {
                setTab: (_, { tab }) => tab,
            },
        ],

        timestampMode: [
            'relative' as 'absolute' | 'relative',
            { persist: true },
            {
                setTimestampMode: (_, { mode }) => mode,
            },
        ],

        selectedMiniFilters: [
            ['all-automatic', 'console-all', 'events-all', 'performance-all'] as string[],
            { persist: true },
            {
                setMiniFilter: (state, { key, enabled }) => {
                    const selectedFilter = MiniFilters.find((x) => x.key === key)

                    if (!selectedFilter) {
                        return state
                    }
                    const filtersInTab = MiniFilters.filter((x) => x.tab === selectedFilter.tab)

                    const newFilters = state.filter((existingSelected) => {
                        const filterInTab = filtersInTab.find((x) => x.key === existingSelected)
                        if (!filterInTab) {
                            return true
                        }

                        if (enabled) {
                            if (selectedFilter.alone) {
                                return false
                            } else {
                                return filterInTab.alone ? false : true
                            }
                        }

                        if (existingSelected !== key) {
                            return true
                        }
                        return false
                    })

                    if (enabled) {
                        newFilters.push(key)
                    } else {
                        // Ensure the first one is checked if no others
                        if (filtersInTab.every((x) => !newFilters.includes(x.key))) {
                            newFilters.push(filtersInTab[0].key)
                        }
                    }

                    return newFilters
                },
            },
        ],
    })),

    selectors({
        miniFilters: [
            (s) => [s.tab, s.selectedMiniFilters],
            (tab, selectedMiniFilters): SharedListMiniFilter[] => {
                return MiniFilters.filter((filter) => filter.tab === tab).map((x) => ({
                    ...x,
                    enabled: selectedMiniFilters.includes(x.key),
                }))
            },
        ],

        miniFiltersByKey: [
            (s) => [s.miniFilters],
            (miniFilters): { [key: string]: SharedListMiniFilter } => {
                return miniFilters.reduce((acc, filter) => {
                    acc[filter.key] = filter
                    return acc
                }, {})
            },
        ],
    }),
])
