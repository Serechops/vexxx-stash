import { Box } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import {
  OptionProps,
  components as reactSelectComponents,
  MultiValueGenericProps,
  SingleValueProps,
} from "react-select";
import cx from "classnames";

import * as GQL from "src/core/generated-graphql";
import {
  queryFindGroupsForSelect,
  queryFindGroupsByIDForSelect,
  useGroupCreate,
} from "src/core/StashService";
import { useConfigurationContext } from "src/hooks/Config";
import { useIntl } from "react-intl";
import { defaultMaxOptionsShown } from "src/core/config";
import { ListFilterModel } from "src/models/list-filter/filter";
import {
  FilterSelectComponent,
  IFilterIDProps,
  IFilterProps,
  IFilterValueProps,
  Option as SelectOption,
} from "../Shared/FilterSelect";
import { useCompare } from "src/hooks/state";
import { sortByRelevance } from "src/utils/query";
import { PatchComponent, PatchFunction } from "src/patch";
import { TruncatedText } from "../Shared/TruncatedText";

export type Group = Pick<
  GQL.Group,
  "id" | "name" | "date" | "front_image_path" | "aliases"
> & {
  studio?: Pick<GQL.Studio, "name"> | null;
};
type Option = SelectOption<Group>;

type FindGroupsResult = Awaited<
  ReturnType<typeof queryFindGroupsForSelect>
>["data"]["findGroups"]["groups"];

function sortGroupsByRelevance(input: string, groups: FindGroupsResult) {
  return sortByRelevance(
    input,
    groups,
    (m) => m.name,
    (m) => (m.aliases ? [m.aliases] : [])
  );
}

const groupSelectSort = PatchFunction(
  "GroupSelect.sort",
  sortGroupsByRelevance
);

export const GroupSelect: React.FC<
  IFilterProps &
  IFilterValueProps<Group> & {
    hoverPlacement?: "top" | "bottom" | "left" | "right";
    excludeIds?: string[];
    filterHook?: (f: ListFilterModel) => ListFilterModel;
  }
> = PatchComponent("GroupSelect", (props) => {
  const [createGroup] = useGroupCreate();

  const { configuration } = useConfigurationContext();
  const intl = useIntl();
  const maxOptionsShown =
    configuration?.ui.maxOptionsShown ?? defaultMaxOptionsShown;
  const defaultCreatable =
    !configuration?.interface.disableDropdownCreate.movie;

  const exclude = useMemo(() => props.excludeIds ?? [], [props.excludeIds]);

  async function loadGroups(input: string): Promise<Option[]> {
    let filter = new ListFilterModel(GQL.FilterMode.Groups);
    filter.searchTerm = input;
    filter.currentPage = 1;
    filter.itemsPerPage = maxOptionsShown;
    filter.sortBy = "name";
    filter.sortDirection = GQL.SortDirectionEnum.Asc;

    if (props.filterHook) {
      filter = props.filterHook(filter);
    }

    const query = await queryFindGroupsForSelect(filter);
    let ret = query.data.findGroups.groups.filter((group) => {
      // HACK - we should probably exclude these in the backend query, but
      // this will do in the short-term
      return !exclude.includes(group.id.toString());
    });

    return groupSelectSort(input, ret).map((group) => ({
      value: group.id,
      object: group,
    }));
  }

  const GroupOption: React.FC<OptionProps<Option, boolean>> = (optionProps) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    const title = object.name;

    // if name does not match the input value but an alias does, show the alias
    const { inputValue } = optionProps.selectProps;
    let alias: string | undefined = "";
    if (!title.toLowerCase().includes(inputValue.toLowerCase())) {
      alias = object.aliases || undefined;
    }

    thisOptionProps = {
      ...optionProps,
      children: (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            width: "100%",
          }}
        >
          {object.front_image_path && (
            <Box
              component="img"
              src={object.front_image_path}
              loading="lazy"
              sx={{
                bgcolor: "background.default",
                mr: 1,
                maxHeight: "50px",
                maxWidth: "89px",
                objectFit: "contain",
                objectPosition: "center",
              }}
            />
          )}

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              maxHeight: "4.1rem",
              overflow: "hidden",
            }}
          >
            <TruncatedText
              className="group-select-title"
              text={
                <Box component="span">
                  {title}
                  {alias && (
                    <Box
                      component="span"
                      sx={{
                        fontSize: "0.8rem",
                        fontWeight: "bold",
                      }}
                    >
                      {` (${alias})`}
                    </Box>
                  )}
                </Box>
              }
              lineCount={1}
            />

            {object.studio?.name && (
              <Box
                component="span"
                sx={{
                  color: "text.secondary",
                  fontSize: "0.9rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {object.studio?.name}
              </Box>
            )}

            {object.date && (
              <Box
                component="span"
                sx={{
                  color: "text.secondary",
                  fontSize: "0.9rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {object.date}
              </Box>
            )}
          </Box>
        </Box>
      ),
    };

    return <reactSelectComponents.Option {...thisOptionProps} />;
  };

  const GroupMultiValueLabel: React.FC<
    MultiValueGenericProps<Option, boolean>
  > = (optionProps) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    thisOptionProps = {
      ...optionProps,
      children: object.name,
    };

    return <reactSelectComponents.MultiValueLabel {...thisOptionProps} />;
  };

  const GroupValueLabel: React.FC<SingleValueProps<Option, boolean>> = (
    optionProps
  ) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    thisOptionProps = {
      ...optionProps,
      children: <>{object.name}</>,
    };

    return <reactSelectComponents.SingleValue {...thisOptionProps} />;
  };

  const onCreate = async (name: string) => {
    const result = await createGroup({
      variables: { input: { name } },
    });
    return {
      value: result.data!.groupCreate!.id,
      item: result.data!.groupCreate!,
      message: "Created group",
    };
  };

  const getNamedObject = (id: string, name: string) => {
    return {
      id,
      name,
    };
  };

  const isValidNewOption = (inputValue: string, options: Group[]) => {
    if (!inputValue) {
      return false;
    }

    if (
      options.some((o) => {
        return (
          o.name.toLowerCase() === inputValue.toLowerCase() ||
          o.aliases?.toLowerCase() === inputValue.toLowerCase()
        );
      })
    ) {
      return false;
    }

    return true;
  };

  return (
    <FilterSelectComponent<Group, boolean>
      {...props}
      className={cx(
        "group-select",
        {
          "group-select-active": props.active,
        },
        props.className
      )}
      loadOptions={loadGroups}
      getNamedObject={getNamedObject}
      isValidNewOption={isValidNewOption}
      components={{
        Option: GroupOption,
        MultiValueLabel: GroupMultiValueLabel,
        SingleValue: GroupValueLabel,
      }}
      isMulti={props.isMulti ?? false}
      creatable={props.creatable ?? defaultCreatable}
      onCreate={onCreate}
      placeholder={
        props.noSelectionString ??
        intl.formatMessage(
          { id: "actions.select_entity" },
          {
            entityType: intl.formatMessage({
              id: props.isMulti ? "groups" : "group",
            }),
          }
        )
      }
      closeMenuOnSelect={!props.isMulti}
    />
  );
});

const _GroupIDSelect: React.FC<IFilterProps & IFilterIDProps<Group>> = (
  props
) => {
  const { ids, onSelect: onSelectValues } = props;

  const [values, setValues] = useState<Group[]>([]);
  const idsChanged = useCompare(ids);

  function onSelect(items: Group[]) {
    setValues(items);
    onSelectValues?.(items);
  }

  async function loadObjectsByID(idsToLoad: string[]): Promise<Group[]> {
    const query = await queryFindGroupsByIDForSelect(idsToLoad);
    const { groups: loadedGroups } = query.data.findGroups;

    return loadedGroups;
  }

  useEffect(() => {
    if (!idsChanged) {
      return;
    }

    if (!ids || ids?.length === 0) {
      setValues([]);
      return;
    }

    // load the values if we have ids and they haven't been loaded yet
    const filteredValues = values.filter((v) => ids.includes(v.id.toString()));
    if (filteredValues.length === ids.length) {
      return;
    }

    const load = async () => {
      const items = await loadObjectsByID(ids);
      setValues(items);
    };

    load();
  }, [ids, idsChanged, values]);

  return <GroupSelect {...props} values={values} onSelect={onSelect} />;
};

export const GroupIDSelect = PatchComponent("GroupIDSelect", _GroupIDSelect);
