import { Button, FormLabel, Box } from "@mui/material";
import React, { useEffect, useState } from "react";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import LoginIcon from "@mui/icons-material/Login";
import { ModalComponent } from "src/components/Shared/Modal";
import { useTagsMerge } from "src/core/StashService";
import { useIntl } from "react-intl";
import { useToast } from "src/hooks/Toast";
import { Tag, TagSelect } from "./TagSelect";

interface ITagMergeModalProps {
  show: boolean;
  onClose: (mergedID?: string) => void;
  tags: Tag[];
}

export const TagMergeModal: React.FC<ITagMergeModalProps> = ({
  show,
  onClose,
  tags,
}) => {
  const [src, setSrc] = useState<Tag[]>([]);
  const [dest, setDest] = useState<Tag | null>(null);

  const [running, setRunning] = useState(false);

  const [mergeTags] = useTagsMerge();

  const intl = useIntl();
  const Toast = useToast();

  const title = intl.formatMessage({
    id: "actions.merge",
  });

  useEffect(() => {
    if (tags.length > 0) {
      setDest(tags[0]);
      setSrc(tags.slice(1));
    }
  }, [tags]);

  async function onMerge() {
    if (!dest) return;

    const source = src.map((s) => s.id);
    const destination = dest.id;

    try {
      setRunning(true);
      const result = await mergeTags({
        variables: {
          source,
          destination,
        },
      });
      if (result.data?.tagsMerge) {
        Toast.success(intl.formatMessage({ id: "toast.merged_tags" }));
        onClose(dest.id);
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setRunning(false);
    }
  }

  function canMerge() {
    return src.length > 0 && dest !== null;
  }

  function switchTags() {
    if (src.length && dest !== null) {
      const newDest = src[0];
      setSrc([...src.slice(1), dest]);
      setDest(newDest);
    }
  }

  return (
    <ModalComponent
      show={show}
      header={title}
      icon={<LoginIcon />}
      accept={{
        text: intl.formatMessage({ id: "actions.merge" }),
        onClick: () => onMerge(),
      }}
      disabled={!canMerge()}
      cancel={{
        variant: "secondary",
        onClick: () => onClose(),
      }}
      isRunning={running}
    >
      <Box className="form-container" px={3}>
        <div className="flex flex-wrap">
          <div className="w-full lg:w-1/2 xl:w-full">
            <div className="flex flex-wrap mb-3">
              <div className="w-full sm:w-1/4 xl:w-full self-center">
                <FormLabel>
                  {intl.formatMessage({ id: "dialogs.merge.source" })}
                </FormLabel>
              </div>
              <div className="w-full sm:w-3/4 xl:w-full">
                <TagSelect
                  isMulti
                  creatable={false}
                  onSelect={(items) => setSrc(items)}
                  values={src}
                  menuPortalTarget={document.body}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-center mb-3">
              <Button
                variant="contained"
                color="secondary"
                onClick={() => switchTags()}
                disabled={!src.length || !dest}
                title={intl.formatMessage({ id: "actions.swap" })}
              >
                <SwapHorizIcon />
              </Button>
            </div>

            <div className="flex flex-wrap mb-3">
              <div className="w-full sm:w-1/4 xl:w-full self-center">
                <FormLabel>
                  {intl.formatMessage({ id: "dialogs.merge.destination" })}
                </FormLabel>
              </div>
              <div className="w-full sm:w-3/4 xl:w-full">
                <TagSelect
                  isMulti={false}
                  creatable={false}
                  onSelect={(items) => setDest(items[0])}
                  values={dest ? [dest] : undefined}
                  menuPortalTarget={document.body}
                />
              </div>
            </div>
          </div>
        </div>
      </Box>
    </ModalComponent>
  );
};
