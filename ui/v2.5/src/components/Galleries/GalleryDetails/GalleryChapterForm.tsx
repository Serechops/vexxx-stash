import React from "react";
import { Box, Button } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { useFormik } from "formik";
import * as yup from "yup";
import * as GQL from "src/core/generated-graphql";
import {
  useGalleryChapterCreate,
  useGalleryChapterUpdate,
  useGalleryChapterDestroy,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import isEqual from "lodash-es/isEqual";
import { formikUtils } from "src/utils/form";
import { yupFormikValidate, yupInputNumber } from "src/utils/yup";

interface IGalleryChapterForm {
  galleryID: string;
  chapter?: GQL.GalleryChapterDataFragment;
  onClose: () => void;
}

export const GalleryChapterForm: React.FC<IGalleryChapterForm> = ({
  galleryID,
  chapter,
  onClose,
}) => {
  const intl = useIntl();

  const [galleryChapterCreate] = useGalleryChapterCreate();
  const [galleryChapterUpdate] = useGalleryChapterUpdate();
  const [galleryChapterDestroy] = useGalleryChapterDestroy();
  const Toast = useToast();

  const isNew = chapter === undefined;

  const schema = yup.object({
    title: yup.string().ensure(),
    image_index: yupInputNumber()
      .integer()
      .moreThan(0)
      .required()
      .label(intl.formatMessage({ id: "image_index" })),
  });

  const initialValues = {
    title: chapter?.title ?? "",
    image_index: chapter?.image_index ?? 1,
  };

  type InputValues = yup.InferType<typeof schema>;

  const formik = useFormik<InputValues>({
    initialValues,
    enableReinitialize: true,
    validate: yupFormikValidate(schema),
    onSubmit: (values) => onSave(schema.cast(values)),
  });

  async function onSave(input: InputValues) {
    try {
      if (isNew) {
        await galleryChapterCreate({
          variables: {
            gallery_id: galleryID,
            ...input,
          },
        });
      } else {
        await galleryChapterUpdate({
          variables: {
            id: chapter.id,
            gallery_id: galleryID,
            ...input,
          },
        });
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      onClose();
    }
  }

  async function onDelete() {
    if (isNew) return;

    try {
      await galleryChapterDestroy({ variables: { id: chapter.id } });
    } catch (e) {
      Toast.error(e);
    } finally {
      onClose();
    }
  }

  const splitProps = {
    labelProps: {
      column: true,
      sm: 3,
    },
    fieldProps: {
      sm: 9,
    },
  };
  const { renderInputField } = formikUtils(intl, formik, splitProps);

  return (
    <Box component="form" noValidate onSubmit={formik.handleSubmit}>
      <div className="form-container px-3">
        {renderInputField("title")}
        {renderInputField("image_index", "number")}
      </div>
      <div className="buttons-container px-3">
        <div className="d-flex">
          <Button
            variant="contained"
            color="primary"
            disabled={(!isNew && !formik.dirty) || !isEqual(formik.errors, {})}
            onClick={() => formik.submitForm()}
          >
            <FormattedMessage id="actions.save" />
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            type="button"
            onClick={onClose}
            className="ml-2"
          >
            <FormattedMessage id="actions.cancel" />
          </Button>
          {!isNew && (
            <Button
              variant="contained"
              color="error"
              className="ml-auto"
              onClick={() => onDelete()}
            >
              <FormattedMessage id="actions.delete" />
            </Button>
          )}
        </div>
      </div>
    </Box>
  );
};
