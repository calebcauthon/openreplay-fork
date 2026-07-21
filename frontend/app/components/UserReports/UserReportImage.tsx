import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

import { userReportsService } from 'App/services';
import type { IUserReport } from 'App/services/UserReportsService';

/**
 * Annotated screenshot attached to a `user_report` issue.
 *
 * OpenReplay's tag API is JSON-only, so the image can't ride along inside the issue
 * payload — the payload carries a `report_id` and the image itself lives in our own
 * storage. This fetches the report by that id and renders the picture inline, which is
 * what turns the issue from "some JSON" into something a support agent can act on.
 */
function UserReportImage({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const {
    data: report,
    isPending,
    error,
  } = useQuery<IUserReport>({
    queryKey: ['user-report', reportId],
    queryFn: () => userReportsService.fetchReport(reportId),
    retry: false,
  });

  const frame = 'rounded-lg border border-gray-light overflow-hidden bg-gray-lightest';

  if (isPending) {
    return (
      <div className={`${frame} h-40 flex items-center justify-center`}>
        <span className="text-disabled-text">{t('Loading screenshot…')}</span>
      </div>
    );
  }

  // The image is a bonus on top of the JSON, so a failure here must never take the
  // event details down with it — degrade to a note and let the properties render.
  if (error || !report?.URL) {
    return (
      <div className={`${frame} h-20 flex items-center justify-center`}>
        <span className="text-disabled-text">
          {t('Screenshot unavailable for this report.')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{t('Reported Screenshot')}</div>
        <a
          href={report.URL}
          target="_blank"
          rel="noreferrer"
          className="link flex items-center gap-1 text-sm"
        >
          <span>{t('Open full size')}</span>
          <ExternalLink size={12} />
        </a>
      </div>
      {report.note ? (
        <div className="text-sm text-disabled-text">{report.note}</div>
      ) : null}
      <a href={report.URL} target="_blank" rel="noreferrer" className={frame}>
        <img
          src={report.URL}
          alt={t('Annotated screenshot reported by the user')}
          className="w-full block"
          style={{ maxHeight: 320, objectFit: 'contain', objectPosition: 'top' }}
        />
      </a>
    </div>
  );
}

export default UserReportImage;
