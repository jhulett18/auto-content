import { zernioRequest } from "../../../../../lib/zernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ZernioAccount = {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string;
  isActive?: boolean;
};

type PrivacyOption = { value: string; label: string };

export async function GET() {
  try {
    const result = await zernioRequest<{ accounts?: ZernioAccount[] }>("/accounts");
    const accounts = await Promise.all(
      (result.accounts ?? [])
        .filter((account) => account.platform === "tiktok" && account.isActive !== false)
        .map(async (account) => {
          const id = account._id ?? account.id;
          if (!id) return null;
          const creator = await zernioRequest<{
            privacy_level_options?: PrivacyOption[];
            privacyLevelOptions?: PrivacyOption[];
            privacyLevels?: PrivacyOption[];
          }>(`/accounts/${encodeURIComponent(id)}/tiktok/creator-info`);
          return {
            id,
            username: account.username ?? "TikTok account",
            privacyLevels: creator.privacyLevels ?? creator.privacy_level_options ?? creator.privacyLevelOptions ?? [],
          };
        }),
    );
    return Response.json({ accounts: accounts.filter(Boolean) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "TikTok accounts could not be loaded." },
      { status: 502 },
    );
  }
}
