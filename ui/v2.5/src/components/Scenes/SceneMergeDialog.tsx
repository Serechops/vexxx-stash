import { Button, TextField, Box, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import React, { useEffect, useMemo, useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { StringListSelect, GallerySelect } from "../Shared/Select";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import LoginIcon from "@mui/icons-material/Login";
import * as FormUtils from "src/utils/form";
import ImageUtils from "src/utils/image";
import TextUtils from "src/utils/text";
import { mutateSceneMerge, queryFindScenesByID } from "src/core/StashService";
import { FormattedMessage, useIntl } from "react-intl";
import { useToast } from "src/hooks/Toast";
import {
  ScrapeDialogRow,
  ScrapedImageRow,
  ScrapedInputGroupRow,
  ScrapedStringListRow,
  ScrapedTextAreaRow,
} from "../Shared/ScrapeDialog/ScrapeDialogRow";
import { ScrapeDialog } from "../Shared/ScrapeDialog/ScrapeDialog";
import { clone, uniq } from "lodash-es";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import { ModalComponent } from "../Shared/Modal";
import { IHasStoredID, sortStoredIdObjects } from "src/utils/data";
import {
  ObjectListScrapeResult,
  ScrapeResult,
  ZeroableScrapeResult,
  hasScrapedValues,
} from "../Shared/ScrapeDialog/scrapeResult";
import {
  ScrapedGroupsRow,
  ScrapedPerformersRow,
  ScrapedStudioRow,
  ScrapedTagsRow,
} from "../Shared/ScrapeDialog/ScrapedObjectsRow";
import { Scene, SceneSelect } from "src/components/Scenes/SceneSelect";

interface IStashIDsField {
  values: GQL.StashId[];
}

const StashIDsField: React.FC<IStashIDsField> = ({ values }) => {
  return <StringListSelect value={values.map((v) => v.stash_id)} />;
};

type MergeOptions = {
  values: GQL.SceneUpdateInput;
  includeViewHistory: boolean;
  includeOHistory: boolean;
};

interface ISceneMergeDetailsProps {
  sources: GQL.SlimSceneDataFragment[];
  dest: GQL.SlimSceneDataFragment;
  onClose: (options?: MergeOptions) => void;
}

const SceneMergeDetails: React.FC<ISceneMergeDetailsProps> = ({
  sources,
  dest,
  onClose,
}) => {
  const intl = useIntl();

  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState<ScrapeResult<string>>(
    new ScrapeResult<string>(dest.title)
  );
  const [code, setCode] = useState<ScrapeResult<string>>(
    new ScrapeResult<string>(dest.code)
  );
  const [url, setURL] = useState<ScrapeResult<string[]>>(
    new ScrapeResult<string[]>(dest.urls)
  );
  const [date, setDate] = useState<ScrapeResult<string>>(
    new ScrapeResult<string>(dest.date)
  );

  const [rating, setRating] = useState(
    new ZeroableScrapeResult<number>(dest.rating100)
  );
  // zero values can be treated as missing for these fields
  const [oCounter, setOCounter] = useState(
    new ScrapeResult<number>(dest.o_counter)
  );
  const [playCount, setPlayCount] = useState(
    new ScrapeResult<number>(dest.play_count)
  );
  const [playDuration, setPlayDuration] = useState(
    new ScrapeResult<number>(dest.play_duration)
  );

  function idToStoredID(o: { id: string; name: string }) {
    return {
      stored_id: o.id,
      name: o.name,
    };
  }

  function groupToStoredID(o: { group: { id: string; name: string } }) {
    return {
      stored_id: o.group.id,
      name: o.group.name,
    };
  }

  const [studio, setStudio] = useState<ScrapeResult<GQL.ScrapedStudio>>(
    new ScrapeResult<GQL.ScrapedStudio>(
      dest.studio ? idToStoredID(dest.studio) : undefined
    )
  );

  function sortIdList(idList?: string[] | null) {
    if (!idList) {
      return;
    }

    const ret = clone(idList);
    // sort by id numerically
    ret.sort((a, b) => {
      return parseInt(a, 10) - parseInt(b, 10);
    });

    return ret;
  }

  function uniqIDStoredIDs<T extends IHasStoredID>(objs: T[]) {
    return objs.filter((o, i) => {
      return objs.findIndex((oo) => oo.stored_id === o.stored_id) === i;
    });
  }

  const [performers, setPerformers] = useState<
    ObjectListScrapeResult<GQL.ScrapedPerformer>
  >(
    new ObjectListScrapeResult<GQL.ScrapedPerformer>(
      sortStoredIdObjects(dest.performers.map(idToStoredID))
    )
  );

  const [groups, setGroups] = useState<
    ObjectListScrapeResult<GQL.ScrapedGroup>
  >(
    new ObjectListScrapeResult<GQL.ScrapedGroup>(
      sortStoredIdObjects(dest.groups.map(groupToStoredID))
    )
  );

  const [tags, setTags] = useState<ObjectListScrapeResult<GQL.ScrapedTag>>(
    new ObjectListScrapeResult<GQL.ScrapedTag>(
      sortStoredIdObjects(dest.tags.map(idToStoredID))
    )
  );

  const [details, setDetails] = useState<ScrapeResult<string>>(
    new ScrapeResult<string>(dest.details)
  );

  const [galleries, setGalleries] = useState<ScrapeResult<string[]>>(
    new ScrapeResult<string[]>(sortIdList(dest.galleries.map((p) => p.id)))
  );

  const [stashIDs, setStashIDs] = useState(new ScrapeResult<GQL.StashId[]>([]));

  const [organized, setOrganized] = useState(
    new ZeroableScrapeResult<boolean>(dest.organized)
  );

  const [image, setImage] = useState<ScrapeResult<string>>(
    new ScrapeResult<string>(dest.paths.screenshot)
  );

  // calculate the values for everything
  // uses the first set value for single value fields, and combines all
  useEffect(() => {
    async function loadImages() {
      const src = sources.find((s) => s.paths.screenshot);
      if (!dest.paths.screenshot || !src) return;

      setLoading(true);

      const destData = await ImageUtils.imageToDataURL(dest.paths.screenshot);
      const srcData = await ImageUtils.imageToDataURL(src.paths.screenshot!);

      // keep destination image by default
      const useNewValue = false;
      setImage(new ScrapeResult(destData, srcData, useNewValue));

      setLoading(false);
    }

    // append dest to all so that if dest has stash_ids with the same
    // endpoint, then it will be excluded first
    const all = sources.concat(dest);

    setTitle(
      new ScrapeResult(
        dest.title,
        sources.find((s) => s.title)?.title,
        !dest.title
      )
    );
    setCode(
      new ScrapeResult(dest.code, sources.find((s) => s.code)?.code, !dest.code)
    );
    setURL(new ScrapeResult(dest.urls, uniq(all.map((s) => s.urls).flat())));
    setDate(
      new ScrapeResult(dest.date, sources.find((s) => s.date)?.date, !dest.date)
    );

    const foundStudio = sources.find((s) => s.studio)?.studio;

    setStudio(
      new ScrapeResult<GQL.ScrapedStudio>(
        dest.studio ? idToStoredID(dest.studio) : undefined,
        foundStudio
          ? {
            stored_id: foundStudio.id,
            name: foundStudio.name,
          }
          : undefined,
        !dest.studio
      )
    );

    setPerformers(
      new ObjectListScrapeResult<GQL.ScrapedPerformer>(
        sortStoredIdObjects(dest.performers.map(idToStoredID)),
        uniqIDStoredIDs(all.map((s) => s.performers.map(idToStoredID)).flat())
      )
    );
    setTags(
      new ObjectListScrapeResult<GQL.ScrapedTag>(
        sortStoredIdObjects(dest.tags.map(idToStoredID)),
        uniqIDStoredIDs(all.map((s) => s.tags.map(idToStoredID)).flat())
      )
    );
    setDetails(
      new ScrapeResult(
        dest.details,
        sources.find((s) => s.details)?.details,
        !dest.details
      )
    );

    setGroups(
      new ObjectListScrapeResult<GQL.ScrapedGroup>(
        sortStoredIdObjects(dest.groups.map(groupToStoredID)),
        uniqIDStoredIDs(all.map((s) => s.groups.map(groupToStoredID)).flat())
      )
    );

    setGalleries(
      new ScrapeResult(
        dest.galleries.map((p) => p.id),
        uniq(all.map((s) => s.galleries.map((p) => p.id)).flat())
      )
    );

    setRating(
      new ScrapeResult(
        dest.rating100,
        sources.find((s) => s.rating100)?.rating100,
        !dest.rating100
      )
    );

    setOCounter(
      new ScrapeResult(
        dest.o_counter ?? 0,
        all.map((s) => s.o_counter ?? 0).reduce((pv, cv) => pv + cv, 0)
      )
    );

    setPlayCount(
      new ScrapeResult(
        dest.play_count ?? 0,
        all.map((s) => s.play_count ?? 0).reduce((pv, cv) => pv + cv, 0)
      )
    );

    setPlayDuration(
      new ScrapeResult(
        dest.play_duration ?? 0,
        all.map((s) => s.play_duration ?? 0).reduce((pv, cv) => pv + cv, 0)
      )
    );

    setOrganized(
      new ScrapeResult(
        dest.organized ?? false,
        sources.every((s) => s.organized)
      )
    );

    setStashIDs(
      new ScrapeResult(
        dest.stash_ids,
        all
          .map((s) => s.stash_ids)
          .flat()
          .filter((s, index, a) => {
            // remove entries with duplicate endpoints
            return index === a.findIndex((ss) => ss.endpoint === s.endpoint);
          })
      )
    );

    loadImages();
  }, [sources, dest]);

  // ensure this is updated if fields are changed
  const hasValues = useMemo(() => {
    return hasScrapedValues([
      title,
      code,
      url,
      date,
      rating,
      oCounter,
      galleries,
      studio,
      performers,
      groups,
      tags,
      details,
      organized,
      stashIDs,
      image,
    ]);
  }, [
    title,
    code,
    url,
    date,
    rating,
    oCounter,
    galleries,
    studio,
    performers,
    groups,
    tags,
    details,
    organized,
    stashIDs,
    image,
  ]);

  function renderScrapeRows() {
    if (loading) {
      return (
        <div>
          <LoadingIndicator />
        </div>
      );
    }

    if (!hasValues) {
      return (
        <div>
          <FormattedMessage id="dialogs.merge.empty_results" />
        </div>
      );
    }

    const trueString = intl.formatMessage({ id: "true" });
    const falseString = intl.formatMessage({ id: "false" });

    return (
      <>
        <ScrapedInputGroupRow
          field="title"
          title={intl.formatMessage({ id: "title" })}
          result={title}
          onChange={(value) => setTitle(value)}
        />
        <ScrapedInputGroupRow
          field="code"
          title={intl.formatMessage({ id: "scene_code" })}
          result={code}
          onChange={(value) => setCode(value)}
        />
        <ScrapedStringListRow
          field="urls"
          title={intl.formatMessage({ id: "urls" })}
          result={url}
          onChange={(value) => setURL(value)}
        />
        <ScrapedInputGroupRow
          field="date"
          title={intl.formatMessage({ id: "date" })}
          placeholder="YYYY-MM-DD"
          result={date}
          onChange={(value) => setDate(value)}
        />
        <ScrapeDialogRow
          field="rating"
          title={intl.formatMessage({ id: "rating" })}
          result={rating}
          originalField={<RatingSystem value={rating.originalValue} disabled />}
          newField={<RatingSystem value={rating.newValue} disabled />}
          onChange={(value) => setRating(value)}
        />
        <ScrapeDialogRow
          field="o_count"
          title={intl.formatMessage({ id: "o_count" })}
          result={oCounter}
          originalField={
            <TextField
              value={oCounter.originalValue ?? 0}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          newField={
            <TextField
              value={oCounter.newValue ?? 0}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          onChange={(value) => setOCounter(value)}
        />
        <ScrapeDialogRow
          field="play_count"
          title={intl.formatMessage({ id: "play_count" })}
          result={playCount}
          originalField={
            <TextField
              value={playCount.originalValue ?? 0}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          newField={
            <TextField
              value={playCount.newValue ?? 0}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          onChange={(value) => setPlayCount(value)}
        />
        <ScrapeDialogRow
          field="play_duration"
          title={intl.formatMessage({ id: "play_duration" })}
          result={playDuration}
          originalField={
            <TextField
              value={TextUtils.secondsToTimestamp(
                playDuration.originalValue ?? 0
              )}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          newField={
            <TextField
              value={TextUtils.secondsToTimestamp(playDuration.newValue ?? 0)}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          onChange={(value) => setPlayDuration(value)}
        />
        <ScrapeDialogRow
          field="galleries"
          title={intl.formatMessage({ id: "galleries" })}
          result={galleries}
          originalField={
            <GallerySelect
              className="react-select"
              ids={galleries.originalValue ?? []}
              onSelect={() => { }}
              isMulti
              isDisabled
            />
          }
          newField={
            <GallerySelect
              className="react-select"
              ids={galleries.newValue ?? []}
              onSelect={() => { }}
              isMulti
              isDisabled
            />
          }
          onChange={(value) => setGalleries(value)}
        />
        <ScrapedStudioRow
          field="studio"
          title={intl.formatMessage({ id: "studios" })}
          result={studio}
          onChange={(value) => setStudio(value)}
        />
        <ScrapedPerformersRow
          field="performers"
          title={intl.formatMessage({ id: "performers" })}
          result={performers}
          onChange={(value) => setPerformers(value)}
          ageFromDate={date.useNewValue ? date.newValue : date.originalValue}
        />
        <ScrapedGroupsRow
          field="groups"
          title={intl.formatMessage({ id: "groups" })}
          result={groups}
          onChange={(value) => setGroups(value)}
        />
        <ScrapedTagsRow
          field="tags"
          title={intl.formatMessage({ id: "tags" })}
          result={tags}
          onChange={(value) => setTags(value)}
        />
        <ScrapedTextAreaRow
          field="details"
          title={intl.formatMessage({ id: "details" })}
          result={details}
          onChange={(value) => setDetails(value)}
        />
        <ScrapeDialogRow
          field="organized"
          title={intl.formatMessage({ id: "organized" })}
          result={organized}
          originalField={
            <TextField
              value={organized.originalValue ? trueString : falseString}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          newField={
            <TextField
              value={organized.newValue ? trueString : falseString}
              InputProps={{ readOnly: true }}
              size="small"
              variant="outlined"
            />
          }
          onChange={(value) => setOrganized(value)}
        />
        <ScrapeDialogRow
          field="stash_ids"
          title={intl.formatMessage({ id: "stash_id" })}
          result={stashIDs}
          originalField={
            <StashIDsField values={stashIDs?.originalValue ?? []} />
          }
          newField={<StashIDsField values={stashIDs?.newValue ?? []} />}
          onChange={(value) => setStashIDs(value)}
        />
        <ScrapedImageRow
          field="cover_image"
          title={intl.formatMessage({ id: "cover_image" })}
          className="scene-cover"
          result={image}
          onChange={(value) => setImage(value)}
        />
      </>
    );
  }

  function createValues(): MergeOptions {
    const all = [dest, ...sources];

    // only set the cover image if it's different from the existing cover image
    const coverImage = image.useNewValue ? image.getNewValue() : undefined;

    return {
      values: {
        id: dest.id,
        title: title.getNewValue(),
        code: code.getNewValue(),
        urls: url.getNewValue(),
        date: date.getNewValue(),
        rating100: rating.getNewValue(),
        o_counter: oCounter.getNewValue(),
        play_count: playCount.getNewValue(),
        play_duration: playDuration.getNewValue(),
        gallery_ids: galleries.getNewValue(),
        studio_id: studio.getNewValue()?.stored_id,
        performer_ids: performers.getNewValue()?.map((p) => p.stored_id!),
        groups: groups.getNewValue()?.map((m) => {
          // find the equivalent group in the original scenes
          const found = all
            .map((s) => s.groups)
            .flat()
            .find((mm) => mm.group.id === m.stored_id);
          return {
            group_id: m.stored_id!,
            scene_index: found!.scene_index,
          };
        }),
        tag_ids: tags.getNewValue()?.map((t) => t.stored_id!),
        details: details.getNewValue(),
        organized: organized.getNewValue(),
        stash_ids: stashIDs.getNewValue(),
        cover_image: coverImage,
      },
      includeViewHistory: playCount.getNewValue() !== undefined,
      includeOHistory: oCounter.getNewValue() !== undefined,
    };
  }

  const dialogTitle = intl.formatMessage({
    id: "actions.merge",
  });

  const destinationLabel = !hasValues
    ? ""
    : intl.formatMessage({ id: "dialogs.merge.destination" });
  const sourceLabel = !hasValues
    ? ""
    : intl.formatMessage({ id: "dialogs.merge.source" });

  return (
    <ScrapeDialog
      title={dialogTitle}
      existingLabel={destinationLabel}
      scrapedLabel={sourceLabel}
      onClose={(apply) => {
        if (!apply) {
          onClose();
        } else {
          onClose(createValues());
        }
      }}
    >
      {renderScrapeRows()}
    </ScrapeDialog>
  );
};

interface ISceneMergeModalProps {
  show: boolean;
  onClose: (mergedID?: string) => void;
  scenes: { id: string; title: string }[];
}

export const SceneMergeModal: React.FC<ISceneMergeModalProps> = ({
  show,
  onClose,
  scenes,
}) => {
  const [sourceScenes, setSourceScenes] = useState<Scene[]>([]);
  const [destScene, setDestScene] = useState<Scene[]>([]);

  const [loadedSources, setLoadedSources] = useState<
    GQL.SlimSceneDataFragment[]
  >([]);
  const [loadedDest, setLoadedDest] = useState<GQL.SlimSceneDataFragment>();

  const [running, setRunning] = useState(false);
  const [secondStep, setSecondStep] = useState(false);

  const intl = useIntl();
  const Toast = useToast();

  const title = intl.formatMessage({
    id: "actions.merge",
  });

  useEffect(() => {
    if (scenes.length > 0) {
      // set the first scene as the destination, others as source
      setDestScene([scenes[0]]);

      if (scenes.length > 1) {
        setSourceScenes(scenes.slice(1));
      }
    }
  }, [scenes]);

  async function loadScenes() {
    const sceneIDs = sourceScenes.map((s) => parseInt(s.id));
    sceneIDs.push(parseInt(destScene[0].id));
    const query = await queryFindScenesByID(sceneIDs);
    const { scenes: loadedScenes } = query.data.findScenes;

    setLoadedDest(loadedScenes.find((s) => s.id === destScene[0].id));
    setLoadedSources(loadedScenes.filter((s) => s.id !== destScene[0].id));
    setSecondStep(true);
  }

  async function onMerge(options: MergeOptions) {
    const { values, includeViewHistory, includeOHistory } = options;
    try {
      setRunning(true);
      const result = await mutateSceneMerge(
        destScene[0].id,
        sourceScenes.map((s) => s.id),
        values,
        includeViewHistory,
        includeOHistory
      );
      if (result.data?.sceneMerge) {
        Toast.success(intl.formatMessage({ id: "toast.merged_scenes" }));
        onClose(destScene[0].id);
      }
      onClose();
    } catch (e) {
      Toast.error(e);
    } finally {
      setRunning(false);
    }
  }

  function canMerge() {
    return sourceScenes.length > 0 && destScene.length !== 0;
  }

  function switchScenes() {
    if (sourceScenes.length && destScene.length) {
      const newDest = sourceScenes[0];
      setSourceScenes([...sourceScenes.slice(1), destScene[0]]);
      setDestScene([newDest]);
    }
  }

  if (secondStep && destScene.length > 0) {
    return (
      <SceneMergeDetails
        sources={loadedSources}
        dest={loadedDest!}
        onClose={(values) => {
          setSecondStep(false);
          if (values) {
            onMerge(values);
          } else {
            onClose();
          }
        }}
      />
    );
  }

  return (
    <ModalComponent
      show={show}
      header={title}
      icon={<LoginIcon />}
      accept={{
        text: intl.formatMessage({ id: "actions.next_action" }),
        onClick: () => loadScenes(),
      }}
      disabled={!canMerge()}
      cancel={{
        variant: "secondary",
        onClick: () => onClose(),
      }}
      isRunning={running}
    >
      <div className="form-container flex flex-wrap px-3">
        <div className="w-full lg:w-1/2 xl:w-full">
          <Grid container spacing={2} className="mb-3" alignItems="center">
            <Grid size={{ sm: 3, xl: 12 }}>
              <Typography variant="subtitle2" component="label" htmlFor="source">
                {intl.formatMessage({ id: "dialogs.merge.source" })}
              </Typography>
            </Grid>
            <Grid size={{ sm: 9, xl: 12 }}>
              <SceneSelect
                isMulti
                onSelect={(items) => setSourceScenes(items)}
                values={sourceScenes}
                menuPortalTarget={document.body}
              />
            </Grid>
          </Grid>
          <Grid container spacing={2} className="justify-center mb-3">
            <Button
              variant="text"
              color="secondary"
              onClick={() => switchScenes()}
              disabled={!sourceScenes.length || !destScene.length}
              title={intl.formatMessage({ id: "actions.swap" })}
            >
              <SwapHorizIcon />
            </Button>
          </Grid>
          <Grid container spacing={2} className="mb-3" alignItems="center">
            <Grid size={{ sm: 3, xl: 12 }}>
              <Typography variant="subtitle2" component="label" htmlFor="destination">
                {intl.formatMessage({ id: "dialogs.merge.destination" })}
              </Typography>
            </Grid>
            <Grid size={{ sm: 9, xl: 12 }}>
              <SceneSelect
                onSelect={(items) => setDestScene(items)}
                values={destScene}
                menuPortalTarget={document.body}
              />
            </Grid>
          </Grid>
        </div>
      </div>
    </ModalComponent>
  );
};
