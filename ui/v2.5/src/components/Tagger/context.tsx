import React, { useState, useEffect, useRef } from "react";
import uniq from "lodash-es/uniq";
import { blobToBase64 } from "base64-blob";
import { initialConfig, ITaggerConfig } from "src/components/Tagger/constants";
import { prepareQueryString, parsePath } from "src/components/Tagger/utils";
import { objectPath } from "src/core/files";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindPerformer,
  queryFindStudio,
  queryFindTag,
  queryFindScenesByID,
  queryScrapeScene,
  queryScrapeSceneQuery,
  queryScrapeSceneQueryFragment,
  stashBoxSceneBatchQuery,
  mutateStashBoxBatchPerformerTag,
  useListSceneScrapers,
  usePerformerCreate,
  usePerformersCreate,
  usePerformerUpdate,
  useSceneUpdate,
  useScenesUpdate,
  useStudioCreate,
  useStudiosCreate,
  useStudioUpdate,
  useTagCreate,
  useTagsCreate,
  useTagUpdate,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { useConfigurationContext } from "src/hooks/Config";
import { ITaggerSource, SCRAPER_PREFIX, STASH_BOX_PREFIX } from "./constants";
import { errorToString } from "src/utils";
import { mergeStudioStashIDs } from "./utils";
import { useTaggerConfig } from "./config";
import { genderList, stringToGender } from "src/utils/gender";

export interface ITaggerContextState {
  config: ITaggerConfig;
  setConfig: (c: ITaggerConfig) => void;
  loading: boolean;
  loadingMulti?: boolean;
  multiError?: string;
  sources: ITaggerSource[];
  currentSource?: ITaggerSource;
  searchResults: Record<string, ISceneQueryResult>;
  setCurrentSource: (src?: ITaggerSource) => void;
  doSceneQuery: (sceneID: string, searchStr: string) => Promise<void>;
  doSceneFragmentScrape: (sceneID: string) => Promise<void>;
  doMultiSceneFragmentScrape: (sceneIDs: string[]) => Promise<void>;
  stopMultiScrape: () => void;
  createNewTag: (
    tag: GQL.ScrapedTag,
    toCreate: GQL.TagCreateInput
  ) => Promise<string | undefined>;
  createNewPerformer: (
    performer: GQL.ScrapedPerformer,
    toCreate: GQL.PerformerCreateInput
  ) => Promise<string | undefined>;
  linkPerformer: (
    performer: GQL.ScrapedPerformer,
    performerID: string
  ) => Promise<void>;
  createNewStudio: (
    studio: GQL.ScrapedStudio,
    toCreate: GQL.StudioCreateInput
  ) => Promise<string | undefined>;
  updateStudio: (studio: GQL.StudioUpdateInput) => Promise<void>;
  linkStudio: (studio: GQL.ScrapedStudio, studioID: string) => Promise<void>;
  updateTag: (
    tag: GQL.ScrapedTag,
    updateInput: GQL.TagUpdateInput
  ) => Promise<void>;
  resolveScene: (
    sceneID: string,
    index: number,
    scene: IScrapedScene
  ) => Promise<void>;
  submitFingerprints: () => Promise<void>;
  pendingFingerprints: string[];
  saveScene: (
    sceneCreateInput: GQL.SceneUpdateInput,
    queueFingerprint: boolean
  ) => Promise<void>;
  doMassSave: () => Promise<void>;
  doMassCreateTags: () => Promise<void>;
  doMassCreatePerformers: () => Promise<void>;
  doMassCreateStudios: () => Promise<void>;
  doRunAll: () => Promise<void>;
  doSearchAll: (scenes: GQL.SlimSceneDataFragment[], globalOverride: string) => Promise<void>;
  pendingTagsCount: number;
  pendingPerformersCount: number;
  pendingStudiosCount: number;
  pendingScenesCount: number;
}

const dummyFn = () => {
  return Promise.resolve();
};
const dummyValFn = () => {
  return Promise.resolve(undefined);
};

export const TaggerStateContext = React.createContext<ITaggerContextState>({
  config: initialConfig,
  setConfig: () => { },
  loading: false,
  sources: [],
  searchResults: {},
  setCurrentSource: () => { },
  doSceneQuery: dummyFn,
  doSceneFragmentScrape: dummyFn,
  doMultiSceneFragmentScrape: dummyFn,
  stopMultiScrape: () => { },
  createNewTag: dummyValFn,
  createNewPerformer: dummyValFn,
  linkPerformer: dummyFn,
  createNewStudio: dummyValFn,
  updateStudio: dummyFn,
  linkStudio: dummyFn,
  updateTag: dummyFn,
  resolveScene: dummyFn,
  submitFingerprints: dummyFn,
  pendingFingerprints: [],
  saveScene: dummyFn,
  doMassSave: dummyFn,
  doMassCreateTags: dummyFn,
  doMassCreatePerformers: dummyFn,
  doMassCreateStudios: dummyFn,
  doRunAll: dummyFn,
  doSearchAll: dummyFn,
  pendingTagsCount: 0,
  pendingPerformersCount: 0,
  pendingStudiosCount: 0,
  pendingScenesCount: 0,
});

export type IScrapedScene = GQL.ScrapedScene & { resolved?: boolean };

export interface ISceneQueryResult {
  results?: IScrapedScene[];
  error?: string;
}

export const TaggerContext: React.FC = ({ children }) => {
  const [loading, setLoading] = useState(false);
  const [loadingMulti, setLoadingMulti] = useState(false);
  const [sources, setSources] = useState<ITaggerSource[]>([]);
  const [currentSource, setCurrentSource] = useState<ITaggerSource>();
  const [multiError, setMultiError] = useState<string | undefined>();
  const [searchResults, setSearchResults] = useState<
    Record<string, ISceneQueryResult>
  >({});

  const stopping = useRef(false);

  const { configuration: stashConfig } = useConfigurationContext();
  const { config, setConfig } = useTaggerConfig();

  const Scrapers = useListSceneScrapers();

  const Toast = useToast();
  const [createTag] = useTagCreate();
  const [createPerformer] = usePerformerCreate();
  const [updatePerformer] = usePerformerUpdate();
  const [createStudio] = useStudioCreate();
  const [updateStudio] = useStudioUpdate();
  const [updateScene] = useSceneUpdate();
  const [updateScenes] = useScenesUpdate();
  const [updateTag] = useTagUpdate();
  const [createTags] = useTagsCreate();
  const [createPerformers] = usePerformersCreate();
  const [createStudios] = useStudiosCreate();

  useEffect(() => {
    if (!stashConfig || !Scrapers.data) {
      return;
    }

    const { stashBoxes } = stashConfig.general;
    const scrapers = Scrapers.data.listScrapers;

    const stashboxSources: ITaggerSource[] = stashBoxes.map((s, i) => ({
      id: `${STASH_BOX_PREFIX}${s.endpoint}`,
      sourceInput: {
        stash_box_endpoint: s.endpoint,
      },
      displayName: `stash-box: ${s.name || `#${i + 1}`}`,
      supportSceneFragment: true,
      supportSceneQuery: true,
    }));

    // filter scraper sources such that only those that can query scrape or
    // scrape via fragment are added
    const scraperSources: ITaggerSource[] = scrapers
      .filter((s) =>
        s.scene?.supported_scrapes.some(
          (t) => t === GQL.ScrapeType.Name || t === GQL.ScrapeType.Fragment
        )
      )
      .map((s) => ({
        id: `${SCRAPER_PREFIX}${s.id}`,
        sourceInput: {
          scraper_id: s.id,
        },
        displayName: s.name,
        supportSceneQuery: s.scene?.supported_scrapes.includes(
          GQL.ScrapeType.Name
        ),
        supportSceneFragment: s.scene?.supported_scrapes.includes(
          GQL.ScrapeType.Fragment
        ),
      }));

    setSources(stashboxSources.concat(scraperSources));
  }, [Scrapers.data, stashConfig]);

  // set the current source on load
  useEffect(() => {
    if (!sources.length || currentSource) {
      return;
    }
    // First, see if we have a saved endpoint.
    if (config.selectedEndpoint) {
      let source = sources.find(
        (s) => s.sourceInput.stash_box_endpoint == config.selectedEndpoint
      );
      if (source) {
        setCurrentSource(source);
        return;
      }
    }
    // Otherwise, just use the first source.
    setCurrentSource(sources[0]);
  }, [sources, currentSource, config]);

  // clear the search results when the source changes
  useEffect(() => {
    setSearchResults({});
  }, [currentSource]);

  // keep selected endpoint in config in sync with current source
  useEffect(() => {
    const selectedEndpoint = currentSource?.sourceInput.stash_box_endpoint;
    if (selectedEndpoint && selectedEndpoint !== config.selectedEndpoint) {
      setConfig({
        ...config,
        selectedEndpoint,
      });
    }
  }, [currentSource, config, setConfig]);

  function getPendingFingerprints() {
    const endpoint = currentSource?.sourceInput.stash_box_endpoint;
    if (!config || !endpoint) return [];

    return config.fingerprintQueue[endpoint] ?? [];
  }

  function clearSubmissionQueue() {
    const endpoint = currentSource?.sourceInput.stash_box_endpoint;
    if (!config || !endpoint) return;

    setConfig({
      ...config,
      fingerprintQueue: {
        ...config.fingerprintQueue,
        [endpoint]: [],
      },
    });
  }

  const [submitFingerprintsMutation] =
    GQL.useSubmitStashBoxFingerprintsMutation();

  async function submitFingerprints() {
    const endpoint = currentSource?.sourceInput.stash_box_endpoint;

    if (!config || !endpoint) return;

    try {
      setLoading(true);
      await submitFingerprintsMutation({
        variables: {
          input: {
            stash_box_endpoint: endpoint,
            scene_ids: config.fingerprintQueue[endpoint],
          },
        },
      });

      clearSubmissionQueue();
    } catch (err) {
      Toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  function queueFingerprintSubmission(sceneId: string) {
    const endpoint = currentSource?.sourceInput.stash_box_endpoint;
    if (!config || !endpoint) return;

    setConfig({
      ...config,
      fingerprintQueue: {
        ...config.fingerprintQueue,
        [endpoint]: [...(config.fingerprintQueue[endpoint] ?? []), sceneId],
      },
    });
  }

  function clearSearchResults(sceneID: string) {
    setSearchResults((current) => {
      const newSearchResults = { ...current };
      delete newSearchResults[sceneID];
      return newSearchResults;
    });
  }

  async function doSceneQuery(sceneID: string, searchVal: string) {
    if (!currentSource) {
      return;
    }

    try {
      setLoading(true);
      clearSearchResults(sceneID);

      const results = await queryScrapeSceneQuery(
        currentSource.sourceInput,
        searchVal
      );
      let newResult: ISceneQueryResult;
      // scenes are already resolved if they come from stash-box
      const resolved =
        currentSource.sourceInput.stash_box_endpoint !== undefined;

      if (results.error) {
        newResult = { error: results.error.message };
      } else if (results.errors) {
        newResult = { error: results.errors.toString() };
      } else {
        newResult = {
          results: results.data.scrapeSingleScene.map((r) => ({
            ...r,
            resolved,
          })),
        };
      }

      setSearchResults(prev => ({ ...prev, [sceneID]: newResult }));
    } catch (err) {
      Toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function sceneFragmentScrape(sceneID: string) {
    if (!currentSource) {
      return;
    }

    clearSearchResults(sceneID);

    let newResult: ISceneQueryResult;

    try {
      const results = await queryScrapeScene(
        currentSource.sourceInput,
        sceneID
      );

      if (results.error) {
        newResult = { error: results.error.message };
      } else if (results.errors) {
        newResult = { error: results.errors.toString() };
      } else {
        newResult = {
          results: results.data.scrapeSingleScene.map((r) => ({
            ...r,
            // scenes are already resolved if they are scraped via fragment
            resolved: true,
          })),
        };
      }
    } catch (err: unknown) {
      newResult = { error: errorToString(err) };
    }

    setSearchResults((current) => {
      return { ...current, [sceneID]: newResult };
    });
  }

  async function doSceneFragmentScrape(sceneID: string) {
    if (!currentSource) {
      return;
    }

    clearSearchResults(sceneID);

    try {
      setLoading(true);
      await sceneFragmentScrape(sceneID);
    } catch (err) {
      Toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function doMultiSceneFragmentScrape(sceneIDs: string[]) {
    if (!currentSource) {
      return;
    }

    setSearchResults({});

    try {
      stopping.current = false;
      setLoading(true);
      setMultiError(undefined);

      const stashBoxEndpoint =
        currentSource.sourceInput.stash_box_endpoint ?? undefined;

      // if current source is stash-box, we can use the multi-scene
      // interface
      if (stashBoxEndpoint !== undefined) {
        const results = await stashBoxSceneBatchQuery(
          sceneIDs,
          stashBoxEndpoint
        );

        if (results.error) {
          setMultiError(results.error.message);
        } else if (results.errors) {
          setMultiError(results.errors.toString());
        } else {
          const newSearchResults = { ...searchResults };
          sceneIDs.forEach((sceneID, index) => {
            const newResults = results.data.scrapeMultiScenes[index].map(
              (r) => ({
                ...r,
                resolved: true,
              })
            );

            newSearchResults[sceneID] = {
              results: newResults,
            };
          });

          setSearchResults(newSearchResults);
        }
      } else {
        setLoadingMulti(true);

        // Batching setup
        let pendingResults: Record<string, ISceneQueryResult> = {};
        let resultCount = 0;
        const BATCH_SIZE = 5;

        const flushResults = () => {
          if (resultCount > 0) {
            setSearchResults((prev) => ({ ...prev, ...pendingResults }));
            pendingResults = {};
            resultCount = 0;
          }
        };

        // Concurrency setup
        const CONCURRENCY = 4;
        const queue = [...sceneIDs];
        const workers = Array(CONCURRENCY)
          .fill(null)
          .map(async () => {
            while (queue.length > 0 && !stopping.current) {
              const id = queue.shift();
              if (!id) break;

              try {
                // Inline sceneFragmentScrape logic to capture result without state update
                const results = await queryScrapeScene(
                  currentSource.sourceInput,
                  id
                );

                let newResult: ISceneQueryResult;
                if (results.error) {
                  newResult = { error: results.error.message };
                } else if (results.errors) {
                  newResult = { error: results.errors.toString() };
                } else {
                  newResult = {
                    results: results.data.scrapeSingleScene.map((r) => ({
                      ...r,
                      resolved: true,
                    })),
                  };
                }

                pendingResults[id] = newResult;
                resultCount++;

                if (resultCount >= BATCH_SIZE) {
                  flushResults();
                }
              } catch (err: unknown) {
                pendingResults[id] = { error: errorToString(err) };
                resultCount++;
              }
            }
          });

        await Promise.all(workers);
        flushResults(); // Final flush
      }
    } catch (err) {
      Toast.error(err);
    } finally {
      setLoading(false);
      setLoadingMulti(false);
    }
  }

  function stopMultiScrape() {
    stopping.current = true;
  }

  async function resolveScene(
    sceneID: string,
    index: number,
    scene: IScrapedScene
  ) {
    if (!currentSource || scene.resolved || !searchResults[sceneID].results) {
      return Promise.resolve();
    }

    try {
      const sceneInput: GQL.ScrapedSceneInput = {
        date: scene.date,
        details: scene.details,
        remote_site_id: scene.remote_site_id,
        title: scene.title,
        urls: scene.urls,
      };

      const result = await queryScrapeSceneQueryFragment(
        currentSource.sourceInput,
        sceneInput
      );

      if (result.data.scrapeSingleScene.length) {
        const resolvedScene = result.data.scrapeSingleScene[0];

        // set the scene in the results and mark as resolved
        const newResult = [...searchResults[sceneID].results!];
        newResult[index] = { ...resolvedScene, resolved: true };
        setSearchResults({
          ...searchResults,
          [sceneID]: { ...searchResults[sceneID], results: newResult },
        });
      }
    } catch (err) {
      Toast.error(err);

      const newResult = [...searchResults[sceneID].results!];
      newResult[index] = { ...newResult[index], resolved: true };
      setSearchResults({
        ...searchResults,
        [sceneID]: { ...searchResults[sceneID], results: newResult },
      });
    }
  }

  async function doMassSave() {
    setLoading(true);
    try {
      const targets = Object.entries(searchResults)
        .map(([sceneId, res]) => {
          if (res.error || !res.results) return null;
          let target = res.results.find((r) => r.resolved);
          if (!target && res.results.length === 1) target = res.results[0];
          return target ? { sceneId, target } : null;
        })
        .filter((t) => t !== null) as { sceneId: string; target: IScrapedScene }[];

      if (targets.length === 0) {
        Toast.success("No scenes to save");
        return;
      }

      const sceneIds = targets.map((t) => parseInt(t.sceneId, 10));
      // Chunk ID query if too large? 50 IDs is fine.
      const scenesQuery = await queryFindScenesByID(sceneIds);
      if (!scenesQuery.data?.findScenes?.scenes) {
        throw new Error("Failed to fetch original scenes");
      }
      const originalScenes = scenesQuery.data.findScenes.scenes;
      const originalSceneMap = new Map(originalScenes.map((s) => [s.id, s]));

      const inputs: GQL.SceneUpdateInput[] = [];
      const fingerprintQueue: string[] = [];

      for (const { sceneId, target } of targets) {
        const stashScene = originalSceneMap.get(sceneId);
        if (!stashScene) continue;

        let imgData: string | undefined;
        if (config.setCoverImage && target.image) {
          try {
            const img = await fetch(target.image, {
              mode: "cors",
              cache: "no-store",
            });
            if (img.status === 200) {
              const blob = await img.blob();
              if (blob.size > 0 && blob.size < 5000000) imgData = await blobToBase64(blob);
            }
          } catch (e) {
            console.error("Failed to fetch image", e);
          }
        }

        let tagIds = target.tags?.map((t) => t.stored_id).filter((id) => !!id) as string[] ?? [];
        if (config.tagOperation === "merge") {
          const existingIds = stashScene.tags.map(t => t.id);
          tagIds = uniq(existingIds.concat(tagIds));
        }

        // Always merge performers? StashSearchResult logic suggests so.
        const existingPerformerIds = stashScene.performers.map(p => p.id);
        const newPerformerIds = target.performers?.map(p => p.stored_id).filter(id => !!id) as string[] ?? [];
        const performerIds = uniq(existingPerformerIds.concat(newPerformerIds));

        let stashIds = stashScene.stash_ids ?? [];
        const endpoint = currentSource?.sourceInput.stash_box_endpoint;
        if (endpoint && target.remote_site_id) {
          stashIds = stashIds.filter(s => s.endpoint !== endpoint);
          stashIds.push({
            endpoint,
            stash_id: target.remote_site_id,
            updated_at: new Date().toISOString()
          });
        }

        const input: GQL.SceneUpdateInput = {
          id: sceneId,
          title: target.title ?? stashScene.title,
          details: target.details ?? stashScene.details,
          date: target.date ?? stashScene.date,
          url: target.urls?.[0] ?? stashScene.urls?.[0],
          code: target.code ?? stashScene.code,
          director: target.director ?? stashScene.director,
          studio_id: target.studio?.stored_id ?? stashScene.studio?.id,
          tag_ids: tagIds,
          performer_ids: performerIds,
          stash_ids: stashIds,
          cover_image: imgData,
        };
        inputs.push(input);
        fingerprintQueue.push(sceneId);
      }

      const chunkSize = 5;
      for (let i = 0; i < inputs.length; i += chunkSize) {
        const chunk = inputs.slice(i, i + chunkSize);
        await updateScenes({ variables: { input: chunk } });
      }

      const endpoint = currentSource?.sourceInput.stash_box_endpoint;
      if (endpoint) {
        setConfig({
          ...config,
          fingerprintQueue: {
            ...config.fingerprintQueue,
            [endpoint]: uniq([...(config.fingerprintQueue[endpoint] ?? []), ...fingerprintQueue]),
          },
        });
      }

      setSearchResults((prev) => {
        const next = { ...prev };
        inputs.forEach((i) => delete next[i.id!]);
        return next;
      });

      Toast.success(`Saved ${inputs.length} scenes`);
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function saveScene(
    sceneCreateInput: GQL.SceneUpdateInput,
    queueFingerprint: boolean
  ) {
    try {
      await updateScene({
        variables: {
          input: {
            ...sceneCreateInput,
            // only set organized if it is enabled in the config
            organized: config?.markSceneAsOrganizedOnSave || undefined,
          },
        },
      });

      if (queueFingerprint) {
        queueFingerprintSubmission(sceneCreateInput.id);
      }
      clearSearchResults(sceneCreateInput.id);
    } catch (err) {
      Toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  function mapResults(fn: (r: IScrapedScene) => IScrapedScene) {
    const newSearchResults = { ...searchResults };

    Object.keys(newSearchResults).forEach((k) => {
      const searchResult = searchResults[k];
      if (!searchResult.results) {
        return;
      }

      newSearchResults[k].results = searchResult.results.map(fn);
    });

    return newSearchResults;
  }

  async function doMassCreateTags() {
    if (!config.setTags) return;
    setLoading(true);
    try {
      const tagsToCreate = new Map<string, GQL.TagCreateInput>();
      const tagMap = new Map<string, GQL.ScrapedTag[]>();

      Object.values(searchResults).forEach((res) => {
        res.results?.forEach((scene) => {
          scene.tags?.forEach((t) => {
            if (!t.stored_id && t.name) {
              const key = t.name;
              let existing = tagsToCreate.get(key);

              const stash_ids: GQL.StashIdInput[] = existing?.stash_ids || [];
              if (t.remote_site_id && currentSource?.sourceInput.stash_box_endpoint) {
                const hasId = stash_ids.some(id => id.stash_id === t.remote_site_id);
                if (!hasId) {
                  stash_ids.push({
                    endpoint: currentSource.sourceInput.stash_box_endpoint,
                    stash_id: t.remote_site_id!,
                  });
                }
              }

              if (!existing) {
                tagsToCreate.set(key, { name: t.name, stash_ids });
              } else {
                existing.stash_ids = stash_ids;
              }
              const list = tagMap.get(t.name) ?? [];
              list.push(t);
              tagMap.set(t.name, list);
            }
          });
        });
      });

      if (tagsToCreate.size === 0) {
        Toast.success("No new tags to create");
        return;
      }

      const inputs = Array.from(tagsToCreate.values());
      const result = await createTags({ variables: { input: inputs } });
      const createdTags = result.data?.tagsCreate;

      if (createdTags) {
        setSearchResults(
          mapResults((r) => {
            if (!r.tags) return r;
            return {
              ...r,
              tags: r.tags.map((t) => {
                const created = createdTags.find((ct: any) => ct?.name === t.name);
                if (created) {
                  return { ...t, stored_id: created.id };
                }
                return t;
              }),
            };
          })
        );
        Toast.success(`Created ${createdTags.length} tags`);
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function createNewTag(
    tag: GQL.ScrapedTag,
    toCreate: GQL.TagCreateInput
  ) {
    try {
      const result = await createTag({
        variables: {
          input: toCreate,
        },
      });

      const tagID = result.data?.tagCreate?.id;
      if (tagID === undefined) return undefined;

      const newSearchResults = mapResults((r) => {
        if (!r.tags) {
          return r;
        }

        return {
          ...r,
          tags: r.tags.map((t) => {
            if (t.name === tag.name) {
              return {
                ...t,
                stored_id: tagID,
              };
            }

            return t;
          }),
        };
      });

      setSearchResults(newSearchResults);

      Toast.success(
        <span>
          Created tag: <b>{toCreate.name}</b>
        </span>
      );

      return tagID;
    } catch (e) {
      Toast.error(e);
    }
  }
  async function doMassCreatePerformers() {
    setLoading(true);
    try {
      const performersToCreate = new Map<string, GQL.PerformerCreateInput>();
      const performerMap = new Map<string, GQL.ScrapedPerformer[]>();

      const performerGenders = config.performerGenders || genderList;

      Object.values(searchResults).forEach((res) => {
        res.results?.forEach((scene) => {
          scene.performers?.forEach((p) => {
            if (!p.stored_id && p.name) {
              const gender = p.gender ? stringToGender(p.gender, true) : undefined;
              if (gender && !performerGenders.includes(gender)) return;

              const key = p.name!; // Use name as key
              let existing = performersToCreate.get(key);

              const stash_ids: GQL.StashIdInput[] = existing?.stash_ids || [];
              if (p.remote_site_id && currentSource?.sourceInput.stash_box_endpoint) {
                // Check if we already have this stash_id
                const hasId = stash_ids.some(id => id.stash_id === p.remote_site_id);
                if (!hasId) {
                  stash_ids.push({
                    endpoint: currentSource.sourceInput.stash_box_endpoint,
                    stash_id: p.remote_site_id!,
                  });
                }
              }

              if (!existing) {
                existing = {
                  name: p.name!,
                  gender: p.gender ? stringToGender(p.gender) : undefined,
                  urls: p.urls ?? undefined,
                  birthdate: (p.birthdate || undefined) as any,
                  image: (p.image || undefined) as any,
                  stash_ids,
                };
                performersToCreate.set(key, existing);
              } else {
                // Update existing with better data if available
                if (!existing.gender && p.gender) existing.gender = stringToGender(p.gender);
                if (!existing.birthdate && p.birthdate) existing.birthdate = p.birthdate as any;
                if (!existing.image && p.image) existing.image = p.image as any;
                if ((!existing.urls || existing.urls.length === 0) && p.urls) existing.urls = p.urls;
                existing.stash_ids = stash_ids;
              }
            }
          });
        });
      });

      if (performersToCreate.size === 0) {
        Toast.success("No new performers to create");
        return;
      }

      const inputs = Array.from(performersToCreate.values());
      const result = await createPerformers({ variables: { input: inputs } });
      const createdPerformers = result.data?.performersCreate;

      if (createdPerformers) {
        setSearchResults(
          mapResults((r) => {
            if (!r.performers) return r;
            return {
              ...r,
              performers: r.performers.map((p) => {
                const created = createdPerformers.find(
                  (cp: any) => cp?.name === p.name
                );
                if (created) {
                  return { ...p, stored_id: created.id };
                }
                return p;
              }),
            };
          })
        );
        Toast.success(`Created ${createdPerformers.length} performers`);

        // Trigger batch update for created performers to ensure they are identified/populated
        const endpoint = currentSource?.sourceInput.stash_box_endpoint;
        if (endpoint && stashConfig) {
          const endpointIndex = stashConfig.general.stashBoxes.findIndex(
            (s) => s.endpoint === endpoint
          );

          if (endpointIndex !== -1) {
            const createdIds = createdPerformers.map((p: any) => p.id);
            try {
              await mutateStashBoxBatchPerformerTag({
                ids: createdIds,
                endpoint: endpointIndex,
                refresh: true,
                exclude_fields: config.excludedPerformerFields ?? [],
                createParent: false,
              });
            } catch (err) {
              console.error("Failed to trigger batch performer update", err);
            }
          }
        }
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }


  async function createNewPerformer(
    performer: GQL.ScrapedPerformer,
    toCreate: GQL.PerformerCreateInput
  ) {
    try {
      const result = await createPerformer({
        variables: {
          input: toCreate,
        },
      });

      const performerID = result.data?.performerCreate?.id;
      if (performerID === undefined) return undefined;

      const newSearchResults = mapResults((r) => {
        if (!r.performers) {
          return r;
        }

        return {
          ...r,
          performers: r.performers.map((p) => {
            // Match by remote_site_id if available, otherwise fall back to name
            const matches = performer.remote_site_id
              ? p.remote_site_id === performer.remote_site_id
              : p.name === performer.name;

            if (matches) {
              return {
                ...p,
                stored_id: performerID,
              };
            }

            return p;
          }),
        };
      });

      setSearchResults(newSearchResults);

      Toast.success(
        <span>
          Created performer: <b>{toCreate.name}</b>
        </span>
      );

      return performerID;
    } catch (e) {
      Toast.error(e);
    }
  }

  async function linkPerformer(
    performer: GQL.ScrapedPerformer,
    performerID: string
  ) {
    if (
      !performer.remote_site_id ||
      !currentSource?.sourceInput.stash_box_endpoint
    )
      return;

    try {
      const queryResult = await queryFindPerformer(performerID);
      if (queryResult.data.findPerformer) {
        const target = queryResult.data.findPerformer;

        const stashIDs: GQL.StashIdInput[] = target.stash_ids.map((e) => {
          return {
            endpoint: e.endpoint,
            stash_id: e.stash_id,
            updated_at: e.updated_at,
          };
        });

        stashIDs.push({
          stash_id: performer.remote_site_id,
          endpoint: currentSource?.sourceInput.stash_box_endpoint,
          updated_at: new Date().toISOString(),
        });

        await updatePerformer({
          variables: {
            input: {
              id: performerID,
              stash_ids: stashIDs,
            },
          },
        });

        const newSearchResults = mapResults((r) => {
          if (!r.performers) {
            return r;
          }

          return {
            ...r,
            performers: r.performers.map((p) => {
              if (p.remote_site_id === performer.remote_site_id) {
                return {
                  ...p,
                  stored_id: performerID,
                };
              }

              return p;
            }),
          };
        });

        setSearchResults(newSearchResults);

        Toast.success(<span>Added stash-id to performer</span>);
      }
    } catch (e) {
      Toast.error(e);
    }
  }

  async function createNewStudio(
    studio: GQL.ScrapedStudio,
    toCreate: GQL.StudioCreateInput
  ) {
    try {
      const result = await createStudio({
        variables: {
          input: toCreate,
        },
      });

      const studioID = result.data?.studioCreate?.id;
      if (studioID === undefined) return undefined;

      const newSearchResults = mapResults((r) => {
        if (!r.studio) {
          return r;
        }

        let resultStudio = r.studio;
        if (resultStudio.name === studio.name) {
          resultStudio = {
            ...resultStudio,
            stored_id: studioID,
          };
        }

        // #5821 - set the stored_id of the parent studio if it matches too
        if (resultStudio.parent?.name === studio.name) {
          resultStudio = {
            ...resultStudio,
            parent: {
              ...resultStudio.parent,
              stored_id: studioID,
            },
          };
        }

        return {
          ...r,
          studio: resultStudio,
        };
      });

      setSearchResults(newSearchResults);

      Toast.success(
        <span>
          Created studio: <b>{toCreate.name}</b>
        </span>
      );

      return studioID;
    } catch (e) {
      Toast.error(e);
    }
  }

  async function updateExistingStudio(input: GQL.StudioUpdateInput) {
    try {
      const inputCopy = { ...input };
      inputCopy.stash_ids = await mergeStudioStashIDs(
        input.id,
        input.stash_ids ?? []
      );
      const result = await updateStudio({
        variables: {
          input: input,
        },
      });

      const studioID = result.data?.studioUpdate?.id;

      const stashID = input.stash_ids?.find((e) => {
        return e.endpoint === currentSource?.sourceInput.stash_box_endpoint;
      })?.stash_id;

      if (stashID) {
        const newSearchResults = mapResults((r) => {
          if (!r.studio) {
            return r;
          }

          return {
            ...r,
            studio:
              r.remote_site_id === stashID
                ? {
                  ...r.studio,
                  stored_id: studioID,
                }
                : r.studio,
          };
        });

        setSearchResults(newSearchResults);
      }

      Toast.success(
        <span>
          Created studio: <b>{input.name}</b>
        </span>
      );
    } catch (e) {
      Toast.error(e);
    }
  }

  async function linkStudio(studio: GQL.ScrapedStudio, studioID: string) {
    if (
      !studio.remote_site_id ||
      !currentSource?.sourceInput.stash_box_endpoint
    )
      return;

    try {
      const queryResult = await queryFindStudio(studioID);
      if (queryResult.data.findStudio) {
        const target = queryResult.data.findStudio;

        const stashIDs: GQL.StashIdInput[] = target.stash_ids.map((e) => {
          return {
            endpoint: e.endpoint,
            stash_id: e.stash_id,
            updated_at: e.updated_at,
          };
        });

        stashIDs.push({
          stash_id: studio.remote_site_id,
          endpoint: currentSource?.sourceInput.stash_box_endpoint,
          updated_at: new Date().toISOString(),
        });

        await updateStudio({
          variables: {
            input: {
              id: studioID,
              stash_ids: stashIDs,
            },
          },
        });

        const newSearchResults = mapResults((r) => {
          if (!r.studio) {
            return r;
          }

          return {
            ...r,
            studio:
              r.studio.remote_site_id === studio.remote_site_id
                ? {
                  ...r.studio,
                  stored_id: studioID,
                }
                : r.studio,
          };
        });

        setSearchResults(newSearchResults);

        Toast.success(<span>Added stash-id to studio</span>);
      }
    } catch (e) {
      Toast.error(e);
    }
  }

  async function updateExistingTag(
    tag: GQL.ScrapedTag,
    updateInput: GQL.TagUpdateInput
  ) {
    const hasRemoteID = !!tag.remote_site_id;

    try {
      const inputCopy = { ...updateInput };

      // Merge stash_ids if we can find the existing tag
      try {
        const queryResult = await queryFindTag(updateInput.id);
        if (queryResult.data.findTag) {
          const existingIds = queryResult.data.findTag.stash_ids || [];
          const newIds = inputCopy.stash_ids || [];

          inputCopy.stash_ids = existingIds.map(e => ({
            endpoint: e.endpoint,
            stash_id: e.stash_id,
          }));

          newIds.forEach(newId => {
            if (!inputCopy.stash_ids!.some(e => e.endpoint === newId.endpoint && e.stash_id === newId.stash_id)) {
              inputCopy.stash_ids!.push(newId);
            }
          });
        }
      } catch (err) {
        console.error("Failed to fetch existing tag for stash_id merge", err);
      }

      await updateTag({
        variables: {
          input: inputCopy,
        },
      });

      const newSearchResults = mapResults((r) => {
        if (!r.tags) {
          return r;
        }

        return {
          ...r,
          tags: r.tags.map((t) => {
            if (
              (hasRemoteID && t.remote_site_id === tag.remote_site_id) ||
              (!hasRemoteID && t.name === tag.name)
            ) {
              return {
                ...t,
                stored_id: updateInput.id,
              };
            }

            return t;
          }),
        };
      });

      setSearchResults(newSearchResults);

      Toast.success(<span>Updated tag</span>);
    } catch (e) {
      Toast.error(e);
    }
  }

  async function doMassCreateStudios() {
    setLoading(true);
    try {
      const studiosToCreate = new Map<string, GQL.StudioCreateInput>();
      const studioMap = new Map<string, GQL.ScrapedStudio[]>();

      Object.values(searchResults).forEach((res) => {
        res.results?.forEach((scene) => {
          if (scene.studio && !scene.studio.stored_id && scene.studio.name) {
            const key = scene.studio.name;
            let existing = studiosToCreate.get(key);

            const stash_ids: GQL.StashIdInput[] = existing?.stash_ids || [];
            if (scene.studio.remote_site_id && currentSource?.sourceInput.stash_box_endpoint) {
              const hasId = stash_ids.some(id => id.stash_id === scene.studio!.remote_site_id);
              if (!hasId) {
                stash_ids.push({
                  endpoint: currentSource.sourceInput.stash_box_endpoint,
                  stash_id: scene.studio.remote_site_id!,
                });
              }
            }

            if (!existing) {
              existing = {
                name: scene.studio.name,
                url: scene.studio.url ?? undefined,
                image: (scene.studio.image || undefined) as any,
                stash_ids,
              };
              studiosToCreate.set(key, existing);
            } else {
              // Update existing with better data
              if (!existing.url && scene.studio.url) existing.url = scene.studio.url;
              if (!existing.image && scene.studio.image) existing.image = scene.studio.image as any;
              existing.stash_ids = stash_ids;
            }
          }
        });
      });

      if (studiosToCreate.size === 0) {
        Toast.success("No new studios to create");
        return;
      }

      const inputs = Array.from(studiosToCreate.values());
      const result = await createStudios({ variables: { input: inputs } });
      const createdStudios = result.data?.studiosCreate;

      if (createdStudios) {
        setSearchResults(
          mapResults((r) => {
            if (!r.studio) return r;
            const created = createdStudios.find((cs: any) => cs?.name === r.studio?.name);
            if (created) {
              // Handle parent hierarchy if needed, but for now simple match
              let resultStudio = r.studio;
              if (resultStudio.name === created.name) {
                return { ...r, studio: { ...r.studio, stored_id: created.id } };
              }
            }
            return r;
          })
        );
        Toast.success(`Created ${createdStudios.length} studios`);
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  // Compute pending counts
  const pendingTagsCount = React.useMemo(() => {
    const tagSet = new Set<string>();
    if (!config.setTags) return 0;
    Object.values(searchResults).forEach((res) => {
      res.results?.forEach((scene) => {
        scene.tags?.forEach((t) => {
          if (!t.stored_id && t.name) tagSet.add(t.name);
        });
      });
    });
    return tagSet.size;
  }, [searchResults]);

  const pendingPerformersCount = React.useMemo(() => {
    const performerSet = new Set<string>();
    const performerGenders = config.performerGenders || genderList;

    Object.values(searchResults).forEach((res) => {
      res.results?.forEach((scene) => {
        scene.performers?.forEach((p) => {
          if (!p.stored_id && p.name) {
            const gender = p.gender ? stringToGender(p.gender, true) : undefined;
            if (gender && !performerGenders.includes(gender)) return;
            performerSet.add(p.name);
          }
        });
      });
    });
    return performerSet.size;
  }, [searchResults]);

  const pendingStudiosCount = React.useMemo(() => {
    const studioSet = new Set<string>();
    Object.values(searchResults).forEach((res) => {
      res.results?.forEach((scene) => {
        if (scene.studio && !scene.studio.stored_id && scene.studio.name) {
          studioSet.add(scene.studio.name);
        }
      });
    });
    return studioSet.size;
  }, [searchResults]);

  const pendingScenesCount = React.useMemo(() => {
    let count = 0;
    Object.values(searchResults).forEach((res) => {
      if (res.results && res.results.length > 0) {
        count++;
      }
    });
    return count;
  }, [searchResults]);

  async function doRunAll() {
    await doMassCreateTags();
    await doMassCreatePerformers();
    await doMassCreateStudios();
    await doMassSave();
  }

  async function doSearchAll(scenes: GQL.SlimSceneDataFragment[], globalOverride: string) {
    if (!globalOverride || scenes.length === 0) return;
    setLoading(true);
    try {
      for (const scene of scenes) {
        // Calculate per-scene query like TaggerScene does
        const { paths, file: basename } = parsePath(objectPath(scene));
        const defaultQuery = prepareQueryString(
          scene,
          paths,
          basename,
          config?.mode ?? "auto",
          config?.blacklist ?? []
        );
        // Append the global override to each scene's default query
        const combinedQuery = `${defaultQuery} ${globalOverride}`;
        await doSceneQuery(scene.id, combinedQuery);
      }
      Toast.success(`Searched ${scenes.length} scenes`);
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <TaggerStateContext.Provider
      value={{
        config: config ?? initialConfig,
        setConfig,
        loading: loading || loadingMulti,
        loadingMulti,
        multiError,
        sources,
        currentSource,
        searchResults,
        setCurrentSource: (src) => {
          setCurrentSource(src);
        },
        doSceneQuery,
        doSceneFragmentScrape,
        doMultiSceneFragmentScrape,
        stopMultiScrape,
        createNewTag,
        createNewPerformer,
        linkPerformer,
        createNewStudio,
        updateStudio: updateExistingStudio,
        linkStudio,
        updateTag: updateExistingTag,
        resolveScene,
        saveScene,
        doMassSave,
        doMassCreateTags,
        doMassCreatePerformers,
        doMassCreateStudios,
        doRunAll,
        doSearchAll,
        pendingTagsCount,
        pendingPerformersCount,
        pendingStudiosCount,
        pendingScenesCount,
        submitFingerprints,
        pendingFingerprints: getPendingFingerprints(),
      }}
    >
      {children}
    </TaggerStateContext.Provider>
  );
};
