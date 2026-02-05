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
        id={`${keyPrefix}scan-rescan`}
        headingID="config.tasks.rescan"
        tooltipID="config.tasks.rescan_tooltip"
        checked={options.rescan ?? false}
        onChange={(v) => setOptions({ rescan: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-previews`}
        headingID="config.tasks.generate_video_previews_during_scan"
        checked={options.scanGeneratePreviews ?? false}
        onChange={(v) => setOptions({ scanGeneratePreviews: v })}
      />
      <BooleanSetting
        advanced
        id={`${keyPrefix}scan-generate-image-previews`}
        className="sub-setting"
        headingID="config.tasks.generate_previews_during_scan"
        checked={options.scanGenerateImagePreviews ?? false}
        disabled={!options.scanGeneratePreviews}
        onChange={(v) => setOptions({ scanGenerateImagePreviews: v })}
      />

      <BooleanSetting
        id={`${keyPrefix}scan-generate-sprites`}
        headingID="config.tasks.generate_sprites_during_scan"
        tooltipID="config.tasks.generate_sprites_during_scan_tooltip"
        checked={options.scanGenerateSprites ?? false}
        onChange={(v) => setOptions({ scanGenerateSprites: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-phashes`}
        checked={options.scanGeneratePhashes ?? false}
        headingID="config.tasks.generate_phashes_during_scan"
        tooltipID="config.tasks.generate_phashes_during_scan_tooltip"
        onChange={(v) => setOptions({ scanGeneratePhashes: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-thumbnails`}
        checked={options.scanGenerateThumbnails ?? false}
        headingID="config.tasks.generate_thumbnails_during_scan"
        onChange={(v) => setOptions({ scanGenerateThumbnails: v })}
      />
      <BooleanSetting
        id="scan-generate-image-phashes"
        checked={options.scanGenerateImagePhashes ?? false}
        headingID="config.tasks.generate_image_phashes_during_scan"
        tooltipID="config.tasks.generate_image_phashes_during_scan_tooltip"
        onChange={(v) => setOptions({ scanGenerateImagePhashes: v })}
      />
      <BooleanSetting
        id={`${keyPrefix}scan-generate-clip-previews`}
        checked={options.scanGenerateClipPreviews ?? false}
        headingID="config.tasks.generate_clip_previews_during_scan"
        onChange={(v) => setOptions({ scanGenerateClipPreviews: v })}
      />
    </>
  );
};
