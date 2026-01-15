import React, { useMemo } from "react";
import { Grid, Typography, Box } from "@mui/material";
import { ModalComponent } from "../Modal";
import { FormattedMessage, useIntl } from "react-intl";
import { faPencilAlt } from "@fortawesome/free-solid-svg-icons";
import { useConfigurationContext } from "src/hooks/Config";

export interface IScrapeDialogContextState {
  existingLabel?: React.ReactNode;
  scrapedLabel?: React.ReactNode;
}

export const ScrapeDialogContext =
  React.createContext<IScrapeDialogContextState>({});

interface IScrapeDialogProps {
  className?: string;
  title: string;
  existingLabel?: React.ReactNode;
  scrapedLabel?: React.ReactNode;
  onClose: (apply?: boolean) => void;
  footerButtons?: React.ReactNode;
  hideApply?: boolean;
}

export const ScrapeDialog: React.FC<
  React.PropsWithChildren<IScrapeDialogProps>
> = (props: React.PropsWithChildren<IScrapeDialogProps>) => {
  const intl = useIntl();
  const { configuration } = useConfigurationContext();
  const { sfwContentMode } = configuration.interface;

  const existingLabel = useMemo(
    () =>
      props.existingLabel ?? (
        <FormattedMessage id="dialogs.scrape_results_existing" />
      ),
    [props.existingLabel]
  );
  const scrapedLabel = useMemo(
    () =>
      props.scrapedLabel ?? (
        <FormattedMessage id="dialogs.scrape_results_scraped" />
      ),
    [props.scrapedLabel]
  );

  const contextState = useMemo(
    () => ({
      existingLabel: existingLabel,
      scrapedLabel: scrapedLabel,
    }),
    [existingLabel, scrapedLabel]
  );

  return (
    <ModalComponent
      show
      icon={faPencilAlt}
      header={props.title}
      accept={{
        onClick: () => {
          props.onClose(true);
        },
        text: intl.formatMessage({ id: "actions.apply" }),
      }}
      cancel={{
        onClick: () => props.onClose(),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      maxWidth="lg"
      dialogClassName={`${props.className ?? ""} scrape-dialog ${sfwContentMode ? "sfw-mode" : ""}`}
      footerButtons={props.footerButtons}
      hideAccept={props.hideApply}
    >
      <div className="dialog-container">
        <ScrapeDialogContext.Provider value={contextState}>
          <Box p={2}>
            <Grid container className="px-3 pt-3">
              <Grid size={{ xs: 12, lg: 9 }} sx={{ ml: { lg: '25%' } }}>
                {/* Using margin-left 25% to offset 3 cols in 12 col grid */}
                {/* Or better: use Grid with empty item */}
              </Grid>
            </Grid>
            <Grid container spacing={2} sx={{ display: { xs: 'none', lg: 'flex' }, px: 3, pt: 3 }}>
              <Grid size={{ lg: 3 }}></Grid>
              <Grid size={{ lg: 9 }}>
                <Grid container spacing={2}>
                  <Grid size={{ lg: 6 }}>
                    <Typography variant="subtitle2" color="textSecondary">
                      {existingLabel}
                    </Typography>
                  </Grid>
                  <Grid size={{ lg: 6 }}>
                    <Typography variant="subtitle2" color="textSecondary">
                      {scrapedLabel}
                    </Typography>
                  </Grid>

                </Grid>
              </Grid>
            </Grid>

            {props.children}
          </Box>
        </ScrapeDialogContext.Provider>
      </div>
    </ModalComponent>
  );
};
