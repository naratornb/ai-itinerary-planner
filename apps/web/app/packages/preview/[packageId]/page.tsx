import CreatorPackagePreviewScreen from "../../../../components/creator-package-preview-screen";

export default async function CreatorPackagePreviewPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <CreatorPackagePreviewScreen packageId={packageId} />;
}
