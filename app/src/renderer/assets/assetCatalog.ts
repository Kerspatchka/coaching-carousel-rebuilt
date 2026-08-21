import catalog from './production-manifest.json';

const assetUrls = import.meta.glob('./**/*.webp', {
  eager: true,
  import: 'default'
}) as Record<string, string>;

const assetUrl = (file: string): string => {
  const url = assetUrls[`./${file}`];
  if (!url) throw new Error(`Curated UI asset is missing from the renderer bundle: ${file}`);
  return url;
};

type AssetRecord = {
  key: string;
  label: string;
  file: string;
  sourceAssetId: number;
  sourceAssetName: string;
  width: number;
  height: number;
};

type TeamCatalogRecord = {
  key: string;
  label: string;
  stickerPack?: AssetRecord;
  primaryLogo?: AssetRecord;
  secondaryLogo?: AssetRecord;
  threeDimensionalLogo?: AssetRecord;
  flatHelmet?: AssetRecord;
};

export interface TeamVisuals {
  key: string;
  label: string;
  stickerPack?: string;
  primaryLogo?: string;
  secondaryLogo?: string;
  threeDimensionalLogo?: string;
  flatHelmet?: string;
}

export const shellBackground = assetUrl(catalog.background.file);

export const teamVisualsByKey: Record<string, TeamVisuals> = Object.fromEntries(
  (catalog.teams as TeamCatalogRecord[]).map((team) => [
    team.key,
    {
      key: team.key,
      label: team.label,
      stickerPack: team.stickerPack ? assetUrl(team.stickerPack.file) : undefined,
      primaryLogo: team.primaryLogo ? assetUrl(team.primaryLogo.file) : undefined,
      secondaryLogo: team.secondaryLogo ? assetUrl(team.secondaryLogo.file) : undefined,
      threeDimensionalLogo: team.threeDimensionalLogo ? assetUrl(team.threeDimensionalLogo.file) : undefined,
      flatHelmet: team.flatHelmet ? assetUrl(team.flatHelmet.file) : undefined
    }
  ])
);

const conferenceRecords = catalog.conferenceLogos as AssetRecord[];
export const conferenceLogoByKey: Record<string, string> = Object.fromEntries(
  conferenceRecords.map((record) => [record.key, assetUrl(record.file)])
);

const portraitRecords = catalog.coachPortraits as Array<AssetRecord & { sourcePortraitId?: number }>;
export const coachPortraitByAssetId: Record<number, string> = Object.fromEntries(
  portraitRecords.map((record) => [record.sourceAssetId, assetUrl(record.file)])
);
