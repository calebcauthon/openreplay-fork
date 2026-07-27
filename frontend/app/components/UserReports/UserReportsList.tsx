import React from 'react';
import { observer } from 'mobx-react-lite';
import { Table, Empty, Button, Tooltip } from 'antd';
import { AlertTriangle, Github } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useStore } from 'App/mstore';
import { Link } from 'App/routing';
import { userReport, session, withSiteId } from 'App/routes';
import { userReportsService } from 'App/services';
import type { IUserReport } from 'App/services/UserReportsService';
import { reportSessionPath } from 'App/services/UserReportsService';
import { Loader, NoContent } from 'UI';

/**
 * Support-facing list of annotated-screenshot "user reports".
 * Mirrors the DataManagement list pages (antd Table + react-query + mobx observer)
 * and the Highlights list wrapper/empty-state conventions.
 */
function UserReportsList() {
  const { t } = useTranslation();
  const { projectsStore } = useStore();
  const { siteId } = projectsStore;
  const activeProject = projectsStore.activeSiteId;

  const {
    data: reports = [],
    isPending,
  } = useQuery<IUserReport[]>({
    queryKey: ['user-reports', activeProject],
    queryFn: () => userReportsService.fetchReports(),
    retry: 3,
  });

  const isEmpty = !isPending && reports.length === 0;

  const columns = [
    {
      title: t('Screenshot'),
      dataIndex: 'URL',
      key: 'URL',
      width: 140,
      render: (URL: string, record: IUserReport) =>
        URL ? (
          <Link to={withSiteId(userReport(record.reportId), siteId)}>
            <img
              src={URL}
              alt={t('Report screenshot')}
              style={{
                width: 120,
                height: 72,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid var(--color-gray-light, #ddd)',
              }}
            />
          </Link>
        ) : (
          // TODO(scaffold): placeholder thumbnail when presigned URL missing/expired
          <div
            style={{ width: 120, height: 72 }}
            className="bg-gray-lightest rounded"
          />
        ),
    },
    {
      title: t('Note'),
      dataIndex: 'note',
      key: 'note',
      render: (note: string, record: IUserReport) => (
        <Link to={withSiteId(userReport(record.reportId), siteId)}>
          <span className="link">{note || t('(no note)')}</span>
        </Link>
      ),
    },
    {
      title: t('Page'),
      dataIndex: 'pageUrl',
      key: 'pageUrl',
      render: (pageUrl: string) => (
        <span className="text-disabled-text truncate" title={pageUrl}>
          {pageUrl}
        </span>
      ),
    },
    {
      title: t('Created'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      // TODO(scaffold): format with App/date helpers (e.g. checkForRecent / durationFormatted)
      render: (createdAt: string) =>
        createdAt ? new Date(createdAt).toLocaleString() : '-',
    },
    {
      title: t('Issue'),
      key: 'issue',
      width: 130,
      render: (_: unknown, record: IUserReport) => {
        if (record.issueUrl) {
          return (
            <a
              href={record.issueUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 link"
            >
              <Github size={14} />
              {record.issueId ? `#${record.issueId}` : t('View')}
            </a>
          );
        }
        if (record.issueError) {
          return (
            <Tooltip title={record.issueError}>
              <span className="flex items-center gap-1 text-red">
                <AlertTriangle size={14} />
                {t('Failed')}
              </span>
            </Tooltip>
          );
        }
        // Nothing filed (yet, or auto-filing is disabled server-side).
        return <span className="text-disabled-text">-</span>;
      },
    },
    {
      title: t('Session'),
      key: 'session',
      width: 160,
      render: (_: unknown, record: IUserReport) => {
        const path = reportSessionPath(record, session);
        if (!path) return <span className="text-disabled-text">-</span>;
        return (
          <Link to={withSiteId(path, siteId)}>
            <Button type="link">{t('Play Session')}</Button>
          </Link>
        );
      },
    },
  ];

  return (
    <div
      className="relative w-full mx-auto bg-white rounded-lg p-4"
      style={{ maxWidth: 1360 }}
    >
      <div className="flex items-center mb-4">
        <h1 className="text-2xl font-medium">{t('User Reports')}</h1>
      </div>
      <Loader loading={isPending}>
        <NoContent
          show={isEmpty}
          title={
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('No user reports yet.')}
            />
          }
        >
          <Table
            rowKey="reportId"
            columns={columns}
            dataSource={reports}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
          />
        </NoContent>
      </Loader>
    </div>
  );
}

export default observer(UserReportsList);
