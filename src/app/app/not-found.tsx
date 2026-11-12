import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FallbackSurface } from '@/components/feedback/FallbackSurface';

/** 404 within the app shell — shown when a dashboard/route doesn't exist (e.g. deleted board). */
export default async function AppNotFound() {
  const t = await getTranslations("appChrome");
  return (
    <FallbackSurface code="404" title={t('notFound.body')} description={t('notFound.hint')}>
      <Link href="/app/ask" className="sl-fallback-action sl-fallback-primary">
        {t("notFound.back")}
      </Link>
    </FallbackSurface>
  );
}
