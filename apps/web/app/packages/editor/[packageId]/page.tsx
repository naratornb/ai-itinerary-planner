import PackageEditorScreen from "../../../../components/package-editor-screen";

export default async function SavedPackageEditorPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <PackageEditorScreen packageId={packageId} />;
}
