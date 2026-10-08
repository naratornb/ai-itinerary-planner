import AdminReviewDetail from "../../../../components/admin/admin-review-detail";

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <AdminReviewDetail packageId={packageId} />;
}
