import { Button, FormLabel, Box } from "@mui/material";
import { Row, Col } from "src/components/Shared/Layouts";
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
        <Row>
          <Col xs={12} lg={6} xl={12}>
            <Row className="mb-3">
              <Col sm={3} xl={12} className="align-self-center">
                <FormLabel>
                  {intl.formatMessage({ id: "dialogs.merge.source" })}
                </FormLabel>
              </Col>
              <Col sm={9} xl={12}>
                <TagSelect
                  isMulti
                  creatable={false}
                  onSelect={(items) => setSrc(items)}
                  values={src}
                  menuPortalTarget={document.body}
                />
              </Col>
            </Row>

            <Row className="justify-content-center mb-3">
              <Button
                variant="contained"
                color="secondary"
                onClick={() => switchTags()}
                disabled={!src.length || !dest}
                title={intl.formatMessage({ id: "actions.swap" })}
              >
                <SwapHorizIcon />
              </Button>
            </Row>

            <Row className="mb-3">
              <Col sm={3} xl={12} className="align-self-center">
                <FormLabel>
                  {intl.formatMessage({ id: "dialogs.merge.destination" })}
                </FormLabel>
              </Col>
              <Col sm={9} xl={12}>
                <TagSelect
                  isMulti={false}
                  creatable={false}
                  onSelect={(items) => setDest(items[0])}
                  values={dest ? [dest] : undefined}
                  menuPortalTarget={document.body}
                />
              </Col>
            </Row>
          </Col>
        </Row>
      </Box>
    </ModalComponent>
  );
};
