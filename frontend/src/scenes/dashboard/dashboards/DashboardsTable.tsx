import { useActions, useValues } from 'kea'
import { dashboardsModel } from '~/models/dashboardsModel'
import { dashboardsLogic, DashboardsTab } from 'scenes/dashboard/dashboards/dashboardsLogic'
import { userLogic } from 'scenes/userLogic'
import { teamLogic } from 'scenes/teamLogic'
import { duplicateDashboardLogic } from 'scenes/dashboard/duplicateDashboardLogic'
import { deleteDashboardLogic } from 'scenes/dashboard/deleteDashboardLogic'
import { LemonTable, LemonTableColumn, LemonTableColumns } from 'lib/components/LemonTable'
import { AvailableFeature, DashboardMode, DashboardType } from '~/types'
import { LemonButton } from 'lib/components/LemonButton'
import { DashboardEventSource } from 'lib/utils/eventUsageLogic'
import { PushpinFilled, PushpinOutlined, ShareAltOutlined } from '@ant-design/icons'
import { DashboardPrivilegeLevel } from 'lib/constants'
import { Link } from 'lib/components/Link'
import { urls } from 'scenes/urls'
import { Tooltip } from 'lib/components/Tooltip'
import { IconCottage, IconLock } from 'lib/components/icons'
import { ObjectTags } from 'lib/components/ObjectTags/ObjectTags'
import { createdAtColumn, createdByColumn } from 'lib/components/LemonTable/columnUtils'
import { More } from 'lib/components/LemonButton/More'
import { dashboardLogic } from 'scenes/dashboard/dashboardLogic'
import { LemonDivider } from 'lib/components/LemonDivider'
import { LemonRow } from 'lib/components/LemonRow'

export const DashboardsTable = (): JSX.Element => {
    const { dashboardsLoading } = useValues(dashboardsModel)
    const { unpinDashboard, pinDashboard } = useActions(dashboardsModel)
    const { setCurrentTab } = useActions(dashboardsLogic)
    const { dashboards, searchTerm, currentTab } = useValues(dashboardsLogic)
    const { hasAvailableFeature } = useValues(userLogic)
    const { currentTeam } = useValues(teamLogic)
    const { showDuplicateDashboardModal } = useActions(duplicateDashboardLogic)
    const { showDeleteDashboardModal } = useActions(deleteDashboardLogic)

    const columns: LemonTableColumns<DashboardType> = [
        {
            width: 0,
            dataIndex: 'pinned',
            render: function Render(pinned, { id }) {
                return (
                    <LemonButton
                        size="small"
                        status="primary-alt"
                        onClick={
                            pinned
                                ? () => unpinDashboard(id, DashboardEventSource.DashboardsList)
                                : () => pinDashboard(id, DashboardEventSource.DashboardsList)
                        }
                    >
                        {pinned ? <PushpinFilled /> : <PushpinOutlined />}
                    </LemonButton>
                )
            },
        },
        {
            title: 'Name',
            dataIndex: 'name',
            width: '40%',
            render: function Render(name, { id, description, _highlight, is_shared, effective_privilege_level }) {
                const isPrimary = id === currentTeam?.primary_dashboard
                const canEditDashboard = effective_privilege_level >= DashboardPrivilegeLevel.CanEdit
                return (
                    <div className={_highlight ? 'highlighted' : undefined} style={{ display: 'inline-block' }}>
                        <div className="row-name">
                            <Link data-attr="dashboard-name" to={urls.dashboard(id)}>
                                {name || 'Untitled'}
                            </Link>
                            {!canEditDashboard && (
                                <Tooltip title="You don't have edit permissions for this dashboard.">
                                    <IconLock
                                        style={{
                                            marginLeft: 6,
                                            verticalAlign: '-0.125em',
                                            display: 'inline',
                                        }}
                                    />
                                </Tooltip>
                            )}
                            {is_shared && (
                                <Tooltip title="This dashboard is shared publicly.">
                                    <ShareAltOutlined style={{ marginLeft: 6 }} />
                                </Tooltip>
                            )}
                            {isPrimary && (
                                <Tooltip title="Primary dashboards are shown on the project home page">
                                    <IconCottage
                                        style={{
                                            marginLeft: 6,
                                            color: 'var(--warning)',
                                            fontSize: '1rem',
                                            verticalAlign: '-0.125em',
                                            display: 'inline',
                                        }}
                                    />
                                </Tooltip>
                            )}
                        </div>
                        {hasAvailableFeature(AvailableFeature.DASHBOARD_COLLABORATION) && description && (
                            <span className="row-description">{description}</span>
                        )}
                    </div>
                )
            },
            sorter: (a, b) => (a.name ?? 'Untitled').localeCompare(b.name ?? 'Untitled'),
        },
        ...(hasAvailableFeature(AvailableFeature.TAGGING)
            ? [
                  {
                      title: 'Tags',
                      dataIndex: 'tags' as keyof DashboardType,
                      render: function Render(tags: DashboardType['tags']) {
                          return tags ? <ObjectTags tags={tags} staticOnly /> : null
                      },
                  } as LemonTableColumn<DashboardType, keyof DashboardType | undefined>,
              ]
            : []),
        createdByColumn<DashboardType>() as LemonTableColumn<DashboardType, keyof DashboardType | undefined>,
        createdAtColumn<DashboardType>() as LemonTableColumn<DashboardType, keyof DashboardType | undefined>,
        {
            width: 0,
            render: function RenderActions(_, { id, name }: DashboardType) {
                return (
                    <More
                        overlay={
                            <div style={{ maxWidth: 250 }}>
                                <LemonButton
                                    status="stealth"
                                    to={urls.dashboard(id)}
                                    onClick={() => {
                                        dashboardLogic({ id }).mount()
                                        dashboardLogic({ id }).actions.setDashboardMode(
                                            null,
                                            DashboardEventSource.DashboardsList
                                        )
                                    }}
                                    fullWidth
                                >
                                    View
                                </LemonButton>
                                <LemonButton
                                    status="stealth"
                                    to={urls.dashboard(id)}
                                    onClick={() => {
                                        dashboardLogic({ id }).mount()
                                        dashboardLogic({ id }).actions.setDashboardMode(
                                            DashboardMode.Edit,
                                            DashboardEventSource.DashboardsList
                                        )
                                    }}
                                    fullWidth
                                >
                                    Edit
                                </LemonButton>
                                <LemonButton
                                    status="stealth"
                                    onClick={() => {
                                        showDuplicateDashboardModal(id, name)
                                    }}
                                    fullWidth
                                >
                                    Duplicate
                                </LemonButton>
                                <LemonDivider />
                                <LemonRow icon={<IconCottage className="text-warning" />} fullWidth status="warning">
                                    <span className="text-muted">
                                        Change the default dashboard on the{' '}
                                        <Link to={urls.projectHomepage()}>project home page</Link>.
                                    </span>
                                </LemonRow>

                                <LemonDivider />
                                <LemonButton
                                    onClick={() => {
                                        showDeleteDashboardModal(id)
                                    }}
                                    fullWidth
                                    status="danger"
                                >
                                    Delete dashboard
                                </LemonButton>
                            </div>
                        }
                    />
                )
            },
        },
    ]

    return (
        <LemonTable
            data-attr="dashboards-table"
            pagination={{ pageSize: 100 }}
            dataSource={dashboards as DashboardType[]}
            rowKey="id"
            columns={columns}
            loading={dashboardsLoading}
            defaultSorting={{ columnKey: 'name', order: 1 }}
            emptyState={
                searchTerm ? (
                    `No ${
                        currentTab === DashboardsTab.Pinned
                            ? 'pinned '
                            : currentTab === DashboardsTab.Shared
                            ? 'shared '
                            : ''
                    }dashboards matching "${searchTerm}"!`
                ) : currentTab === DashboardsTab.Pinned ? (
                    <>
                        No dashboards have been pinned for quick access yet.{' '}
                        <Link onClick={() => setCurrentTab(DashboardsTab.All)}>Go to All Dashboards to pin one.</Link>
                    </>
                ) : currentTab === DashboardsTab.Shared ? (
                    <>
                        No dashboards have been shared yet.{' '}
                        <Link onClick={() => setCurrentTab(DashboardsTab.All)}>Go to All Dashboards to share one.</Link>
                    </>
                ) : undefined
            }
            nouns={['dashboard', 'dashboards']}
        />
    )
}
