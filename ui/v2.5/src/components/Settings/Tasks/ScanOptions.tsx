import React from "react";
import * as GQL from "src/core/generated-graphql";
import { BooleanSetting } from "../Inputs";

interface IScanOptions {
  options: GQL.ScanMetadataInput;
  setOptions: (s: GQL.ScanMetadataInput) => void;
  keyPrefix?: string;
}

export const ScanOptions: React.FC<IScanOptions> = ({
  options,
  setOptions: setOptionsState,
  keyPrefix = "",
}) => {
  function setOptions(input: Partial<GQL.ScanMetadataInput>) {
    setOptionsState({ ...options, ...input });
  }

  return (
    <>
      <BooleanSetting
        id={`${keyPrefix}scan-generate-covers`}
        headingID="config.tasks.generate_video_covers_during_scan"
        checked={options.scanGenerateCovers ?? true}
        onChange={(v) => setOptions({ scanGenerateCovers: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-previews`}
        headingID="config.tasks.generate_video_previews_during_scan"
        checked={options.scanGeneratePreviews ?? true}
        onChange={(v) => setOptions({ scanGeneratePreviews: v })}
      />
      <BooleanSetting
        advanced
        id={`${keyPrefix}scan-generate-image-previews`}
        headingID="Generate image previews"
        checked={options.scanGenerateImagePreviews ?? true}
        onChange={(v) => setOptions({ scanGenerateImagePreviews: v })}
      />

      <BooleanSetting
        id={`${keyPrefix}scan-generate-sprites`}
        headingID="config.tasks.generate_sprites_during_scan"
        tooltipID="config.tasks.generate_sprites_during_scan_tooltip"
        checked={options.scanGenerateSprites ?? true}
        onChange={(v) => setOptions({ scanGenerateSprites: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-phashes`}
        checked={options.scanGeneratePhashes ?? true}
        headingID="config.tasks.generate_phashes_during_scan"
        tooltipID="config.tasks.generate_phashes_during_scan_tooltip"
        onChange={(v) => setOptions({ scanGeneratePhashes: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-thumbnails`}
        checked={options.scanGenerateThumbnails ?? true}
        headingID="config.tasks.generate_thumbnails_during_scan"
        onChange={(v) => setOptions({ scanGenerateThumbnails: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-clip-previews`}
        checked={options.scanGenerateClipPreviews ?? true}
        headingID="config.tasks.generate_clip_previews_during_scan"
        onChange={(v) => setOptions({ scanGenerateClipPreviews: v })}
      />
    </>
  );
};
