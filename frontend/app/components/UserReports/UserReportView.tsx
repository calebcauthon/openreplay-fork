import React from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { ArrowLeft } from 'lucide-react';

import { useStore } from 'App/mstore';
import { Link, useParams } from 'App/routing';
import { userReports, session, withSiteId } from 'App/routes';
import { userReportsService } from 'App/services';
import type { IUserReport } from 'App/services/UserReportsService';
import { reportSessionPath } from 'App/services/UserReportsService';
import { Loader, NoContent } from 'UI';

/**
 * Support-facing detail view for a single annotated-screenshot report.
 * Renders the full presigned image plus a deep-link into the OpenReplay replay.
 */
function UserReportView() {
  const { t } = useTranslation();
  const { reportId } = useParams<{ reportId: string }>();
  const { projectsStore } = useStore();
  const { siteId } = projectsStore;

  const {
    data: report,
    isPending,
    error,
  } = useQuery<IUserReport>({
    queryKey: ['user-report', reportId],
    queryFn: () => userReportsService.fetchReport(reportId!),
    retry: (count, e: any) => (e?.cause?.status === 404 ? false : count < 3),
    enabled: Boolean(reportId),
  });

  // Deep-links to the exact moment the report was filed (falls back to session start).
  const replayPath = report ? reportSessionPath(report, session) : null;

  return (
    <div
      className="w-full mx-auto bg-white rounded-lg p-4 flex flex-col gap-4"
      style={{ maxWidth: 1360 }}
    >
      <div className="flex items-center gap-2">
        <Link to={withSiteId(userReports(), siteId)}>
          <Button type="text" icon={<ArrowLeft size={16} />}>
            {t('Back to User Reports')}
          </Button>
        </Link>
      </div>

      <Loader loading={isPending}>
        <NoContent
          show={!isPending && (!!error || !report)}
          title={t('Report not found.')}
        >
          {report ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="text-lg font-medium">
                    {report.note || t('(no note)')}
                  </div>
                  <a
                    href={report.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link text-sm break-all"
                  >
                    {report.pageUrl}
                  </a>
                  {report.createdAt ? (
                    <div className="text-sm text-disabled-text">
                      {/* TODO(scaffold): format with App/date helpers */}
                      {new Date(report.createdAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>

                {replayPath ? (
                  <Link to={withSiteId(replayPath, siteId)}>
                    <Button type="primary">{t('Open Replay')}</Button>
                  </Link>
                ) : null}
              </div>

              <div className="border rounded-lg overflow-hidden bg-gray-lightest flex items-center justify-center">
                {report.URL ? (
                  <img
                    src={report.URL}
                    alt={t('Annotated screenshot')}
                    style={{ maxWidth: '100%', display: 'block' }}
                  />
                ) : (
                  // TODO(scaffold): placeholder when presigned URL missing/expired
                  <div className="p-12 text-disabled-text">
                    {t('Screenshot unavailable')}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </NoContent>
      </Loader>
    </div>
  );
}

export default observer(UserReportView);
