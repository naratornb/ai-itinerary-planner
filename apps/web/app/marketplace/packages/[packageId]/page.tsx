import { MarketplaceDetailScreen } from "../../../../components/marketplace-detail-screen";
import { MarketplaceRouteNav } from "../../../../components/route-screens";

export default async function MarketplacePackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <><MarketplaceRouteNav /><MarketplaceDetailScreen packageId={packageId} /></>;
}
