import React, { useState } from "react";
import { Link } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { FormattedMessage, useIntl } from "react-intl";
import { objectTitle } from "src/core/files";
import { galleryTitle } from "src/core/galleries";
import SceneQueue from "src/models/sceneQueue";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import {
  useSceneUpdate,
  useListSceneScrapers,
  queryScrapeSceneURL,
} from "src/core/StashService";
import { IColumn, ListTable } from "../List/ListTable";
import { useTableColumns } from "src/hooks/useTableColumns";
import { FileSize } from "../Shared/FileSize";
import { CommaList, NewlineList } from "../Shared/CommaList";
import { Box } from "@mui/material";
import { useToast } from "src/hooks/Toast";
import { lazyComponent } from "src/utils/lazyComponent";
import { SceneURLsCell } from "./SceneURLsCell";
import { Performer } from "src/components/Performers/PerformerSelect";
import { Studio } from "src/components/Studios/StudioSelect";
import { Group } from "src/components/Groups/GroupSelect";
import { Tag } from "src/components/Tags/TagSelect";

const SceneScrapeDialog = lazyComponent(
  () => import("./SceneDetails/SceneScrapeDialog")
);

interface ISceneListTableProps {
  scenes: GQL.SlimSceneDataFragment[];
  queue?: SceneQueue;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}

const TABLE_NAME = "scenes";

export const SceneListTable: React.FC<ISceneListTableProps> = (
  props: ISceneListTableProps
) => {
  const intl = useIntl();
  const Toast = useToast();

  const [updateScene] = useSceneUpdate();
  const Scrapers = useListSceneScrapers();

  const [scrapingScene, setScrapingScene] =
    useState<GQL.SlimSceneDataFragment>();
  const [scrapedScene, setScrapedScene] = useState<GQL.ScrapedScene | null>();

  function setRating(v: number | null, sceneId: string) {
    if (sceneId) {
      updateScene({
        variables: {
          input: {
            id: sceneId,
            rating100: v,
          },
        },
      });
    }
  }

  function saveURLs(sceneId: string, urls: string[]) {
    updateScene({
      variables: { input: { id: sceneId, urls } },
    });
  }

  function urlScrapable(url: string): boolean {
    return (Scrapers?.data?.listScrapers ?? []).some((s) =>
      (s?.scene?.urls ?? []).some((u) => url.includes(u))
    );
  }

  async function onScrapeSceneURL(
    scene: GQL.SlimSceneDataFragment,
    url: string
  ) {
    if (!url) return;
    try {
      const result = await queryScrapeSceneURL(url);
      if (!result.data || !result.data.scrapeSceneURL) {
        Toast.success("No scenes found");
        return;
      }
      setScrapingScene(scene);
      setScrapedScene(result.data.scrapeSceneURL);
    } catch (e) {
      Toast.error(e);
    }
  }

  // Apply the reviewed scrape results to the scene via a single update mutation.
  // The SceneScrapeDialog has already resolved/created any new entities, so the
  // returned fragment's stored_ids are safe to write directly.
  async function onApplyScrape(scraped?: GQL.ScrapedSceneDataFragment) {
    const target = scrapingScene;
    setScrapedScene(undefined);
    setScrapingScene(undefined);
    if (!scraped || !target) return;

    const input: GQL.SceneUpdateInput = { id: target.id };
    if (scraped.title) input.title = scraped.title;
    if (scraped.code) input.code = scraped.code;
    if (scraped.details) input.details = scraped.details;
    if (scraped.director) input.director = scraped.director;
    if (scraped.date) input.date = scraped.date;
    if (scraped.urls) input.urls = scraped.urls;
    if (scraped.studio?.stored_id) input.studio_id = scraped.studio.stored_id;
    if (scraped.performers?.length) {
      const ids = scraped.performers
        .filter((p) => p.stored_id)
        .map((p) => p.stored_id!);
      if (ids.length) input.performer_ids = ids;
    }
    if (scraped.groups?.length) {
      const g = scraped.groups
        .filter((x) => x.stored_id)
        .map((x) => ({ group_id: x.stored_id!, scene_index: null }));
      if (g.length) input.groups = g;
    }
    if (scraped.tags?.length) {
      const ids = scraped.tags
        .filter((t) => t.stored_id)
        .map((t) => t.stored_id!);
      if (ids.length) input.tag_ids = ids;
    }
    if (scraped.image) input.cover_image = scraped.image;

    try {
      await updateScene({ variables: { input } });
      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl
              .formatMessage({ id: "scene" })
              .toLocaleLowerCase(),
          }
        )
      );
    } catch (e) {
      Toast.error(e);
    }
  }

  const CoverImageCell = (scene: GQL.SlimSceneDataFragment, index: number) => {
    const title = objectTitle(scene);
    const sceneLink = props.queue
      ? props.queue.makeLink(scene.id, { sceneIndex: index })
      : `/scenes/${scene.id}`;

    return (
      <Link to={sceneLink}>
        <img
          loading="lazy"
          className="image-thumbnail"
          alt={title}
          src={scene.paths.screenshot ?? ""}
        />
      </Link>
    );
  };

  const TitleCell = (scene: GQL.SlimSceneDataFragment, index: number) => {
    const title = objectTitle(scene);
    const sceneLink = props.queue
      ? props.queue.makeLink(scene.id, { sceneIndex: index })
      : `/scenes/${scene.id}`;

    return (
      <Link to={sceneLink} title={title}>
        <span className="ellips-data">{title}</span>
      </Link>
    );
  };

  const DateCell = (scene: GQL.SlimSceneDataFragment) => <>{scene.date}</>;

  const RatingCell = (scene: GQL.SlimSceneDataFragment) => (
    <RatingSystem
      value={scene.rating100}
      onSetRating={(value) => setRating(value, scene.id)}
      clickToRate
      compact
    />
  );

  const DurationCell = (scene: GQL.SlimSceneDataFragment) => {
    const file = scene.files.length > 0 ? scene.files[0] : undefined;
    return file?.duration && TextUtils.secondsToTimestamp(file.duration);
  };

  const TagCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList className="overflowable">
      {scene.tags.map((tag) => (
        <Box component="li" key={tag.id}>
          <Link to={NavUtils.makeTagScenesUrl(tag)}>
            <span>{tag.name}</span>
          </Link>
        </Box>
      ))}
    </CommaList>
  );

  const PerformersCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList className="overflowable">
      {scene.performers.map((performer) => (
        <Box component="li" key={performer.id}>
          <Link to={NavUtils.makePerformerScenesUrl(performer)}>
            <span>{performer.name}</span>
          </Link>
        </Box>
      ))}
    </CommaList>
  );

  const StudioCell = (scene: GQL.SlimSceneDataFragment) => {
    if (scene.studio) {
      return (
        <Link
          to={NavUtils.makeStudioScenesUrl(scene.studio)}
          title={scene.studio.name}
        >
          <span className="ellips-data">{scene.studio.name}</span>
        </Link>
      );
    }
  };

  const GroupCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList className="overflowable">
      {scene.groups.map((sceneGroup) => (
        <Box component="li" key={sceneGroup.group.id}>
          <Link to={NavUtils.makeGroupScenesUrl(sceneGroup.group)}>
            <span className="ellips-data">{sceneGroup.group.name}</span>
          </Link>
        </Box>
      ))}
    </CommaList>
  );

  const GalleriesCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList className="overflowable">
      {scene.galleries.map((gallery) => (
        <Box component="li" key={gallery.id}>
          <Link to={`/galleries/${gallery.id}`}>
            <span>{galleryTitle(gallery)}</span>
          </Link>
        </Box>
      ))}
    </CommaList>
  );

  const PlayCountCell = (scene: GQL.SlimSceneDataFragment) => (
    <FormattedMessage
      id="plays"
      values={{ value: intl.formatNumber(scene.play_count ?? 0) }}
    />
  );

  const PlayDurationCell = (scene: GQL.SlimSceneDataFragment) => (
    <>{TextUtils.secondsToTimestamp(scene.play_duration ?? 0)}</>
  );

  const ResolutionCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList>
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span> {TextUtils.resolution(file?.width, file?.height)}</span>
        </Box>
      ))}
    </CommaList>
  );

  const FileSizeCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList>
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <FileSize size={file.size} />
        </Box>
      ))}
    </CommaList>
  );

  const FrameRateCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList>
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span>
            <FormattedMessage
              id="frames_per_second"
              values={{ value: intl.formatNumber(file.frame_rate ?? 0) }}
            />
          </span>
        </Box>
      ))}
    </CommaList>
  );

  const BitRateCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList>
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span>
            <FormattedMessage
              id="megabits_per_second"
              values={{
                value: intl.formatNumber((file.bit_rate ?? 0) / 1000000, {
                  maximumFractionDigits: 2,
                }),
              }}
            />
          </span>
        </Box>
      ))}
    </CommaList>
  );

  const AudioCodecCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList className="over">
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span>{file.audio_codec}</span>
        </Box>
      ))}
    </CommaList>
  );

  const VideoCodecCell = (scene: GQL.SlimSceneDataFragment) => (
    <CommaList>
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span>{file.video_codec}</span>
        </Box>
      ))}
    </CommaList>
  );

  const PathCell = (scene: GQL.SlimSceneDataFragment) => (
    <NewlineList className="overflowable TruncatedText">
      {scene.files.map((file) => (
        <Box component="li" key={file.id}>
          <span>{file.path}</span>
        </Box>
      ))}
    </NewlineList>
  );

  const URLsCell = (scene: GQL.SlimSceneDataFragment) => (
    <SceneURLsCell
      urls={scene.urls ?? []}
      onSave={(urls) => saveURLs(scene.id, urls)}
      urlScrapable={urlScrapable}
      onScrape={(url) => onScrapeSceneURL(scene, url)}
    />
  );

  interface IColumnSpec {
    value: string;
    label: string;
    defaultShow?: boolean;
    mandatory?: boolean;
    render?: (
      scene: GQL.SlimSceneDataFragment,
      index: number
    ) => React.ReactNode;
  }

  const allColumns: IColumnSpec[] = [
    {
      value: "cover_image",
      label: intl.formatMessage({ id: "cover_image" }),
      defaultShow: true,
      render: CoverImageCell,
    },
    {
      value: "title",
      label: intl.formatMessage({ id: "title" }),
      defaultShow: true,
      mandatory: true,
      render: TitleCell,
    },
    {
      value: "date",
      label: intl.formatMessage({ id: "date" }),
      defaultShow: true,
      render: DateCell,
    },
    {
      value: "rating",
      label: intl.formatMessage({ id: "rating" }),
      defaultShow: true,
      render: RatingCell,
    },
    {
      value: "scene_code",
      label: intl.formatMessage({ id: "scene_code" }),
      render: (s) => <>{s.code}</>,
    },
    {
      value: "duration",
      label: intl.formatMessage({ id: "duration" }),
      defaultShow: true,
      render: DurationCell,
    },
    {
      value: "studio",
      label: intl.formatMessage({ id: "studio" }),
      defaultShow: true,
      render: StudioCell,
    },
    {
      value: "performers",
      label: intl.formatMessage({ id: "performers" }),
      defaultShow: true,
      render: PerformersCell,
    },
    {
      value: "tags",
      label: intl.formatMessage({ id: "tags" }),
      defaultShow: true,
      render: TagCell,
    },
    {
      value: "groups",
      label: intl.formatMessage({ id: "groups" }),
      defaultShow: true,
      render: GroupCell,
    },
    {
      value: "galleries",
      label: intl.formatMessage({ id: "galleries" }),
      defaultShow: true,
      render: GalleriesCell,
    },
    {
      value: "play_count",
      label: intl.formatMessage({ id: "play_count" }),
      render: PlayCountCell,
    },
    {
      value: "play_duration",
      label: intl.formatMessage({ id: "play_duration" }),
      render: PlayDurationCell,
    },
    {
      value: "o_counter",
      label: intl.formatMessage({ id: "o_count" }),
      render: (s) => <>{s.o_counter}</>,
    },
    {
      value: "resolution",
      label: intl.formatMessage({ id: "resolution" }),
      render: ResolutionCell,
    },
    {
      value: "urls",
      label: intl.formatMessage({ id: "urls" }),
      defaultShow: true,
      render: URLsCell,
    },
    {
      value: "path",
      label: intl.formatMessage({ id: "path" }),
      render: PathCell,
    },
    {
      value: "filesize",
      label: intl.formatMessage({ id: "filesize" }),
      render: FileSizeCell,
    },
    {
      value: "framerate",
      label: intl.formatMessage({ id: "framerate" }),
      render: FrameRateCell,
    },
    {
      value: "bitrate",
      label: intl.formatMessage({ id: "bitrate" }),
      render: BitRateCell,
    },
    {
      value: "video_codec",
      label: intl.formatMessage({ id: "video_codec" }),
      render: VideoCodecCell,
    },
    {
      value: "audio_codec",
      label: intl.formatMessage({ id: "audio_codec" }),
      render: AudioCodecCell,
    },
  ];

  const defaultColumns = allColumns
    .filter((col) => col.defaultShow)
    .map((col) => col.value);

  const { selectedColumns, saveColumns } = useTableColumns(
    TABLE_NAME,
    defaultColumns
  );

  const columnRenderFuncs: Record<
    string,
    (scene: GQL.SlimSceneDataFragment, index: number) => React.ReactNode
  > = {};
  allColumns.forEach((col) => {
    if (col.render) {
      columnRenderFuncs[col.value] = col.render;
    }
  });

  function renderCell(
    column: IColumn,
    scene: GQL.SlimSceneDataFragment,
    index: number
  ) {
    const render = columnRenderFuncs[column.value];

    if (render) return render(scene, index);
  }

  function renderScrapeDialog() {
    if (!scrapedScene || !scrapingScene) return;

    const s = scrapingScene;
    const currentScene: Partial<GQL.SceneUpdateInput> = {
      id: s.id,
      title: s.title ?? undefined,
      code: s.code ?? undefined,
      urls: s.urls,
      date: s.date ?? undefined,
      director: s.director ?? undefined,
      details: s.details ?? undefined,
      cover_image: s.paths.screenshot ?? undefined,
      stash_ids: s.stash_ids as GQL.StashIdInput[],
    };

    return (
      <React.Suspense fallback={null}>
        <SceneScrapeDialog
          scene={currentScene}
          sceneStudio={
            s.studio
              ? ({ id: s.studio.id, name: s.studio.name } as Studio)
              : null
          }
          sceneTags={s.tags.map((t) => ({ id: t.id, name: t.name })) as Tag[]}
          scenePerformers={
            s.performers.map((p) => ({
              id: p.id,
              name: p.name,
            })) as Performer[]
          }
          sceneGroups={
            s.groups.map((g) => ({
              id: g.group.id,
              name: g.group.name,
            })) as Group[]
          }
          scraped={scrapedScene}
          onClose={(sd) => onApplyScrape(sd)}
        />
      </React.Suspense>
    );
  }

  return (
    <>
      {renderScrapeDialog()}
      <ListTable
        className="scene-table"
        items={props.scenes}
        allColumns={allColumns}
        columns={selectedColumns}
        setColumns={(c) => saveColumns(c)}
        selectedIds={props.selectedIds}
        onSelectChange={props.onSelectChange}
        renderCell={renderCell}
      />
    </>
  );
};
