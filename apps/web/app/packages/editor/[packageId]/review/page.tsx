import PackageReviewScreen from "../../../../../components/package-review-screen";

export default async function PackageReviewPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <PackageReviewScreen packageId={packageId} />;
}
