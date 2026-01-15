import React, { useEffect, useRef, useState } from "react";
import { Box, Button, TextField } from "@mui/material";
import { useIntl } from "react-intl";

import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "src/components/Shared/Modal";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useScrapePerformerList } from "src/core/StashService";
import { useDebounce } from "src/hooks/debounce";



interface IProps {
  scraper: GQL.Scraper;
  onHide: () => void;
  onSelectPerformer: (
    performer: GQL.ScrapedPerformerDataFragment,
    scraper: GQL.Scraper
  ) => void;
  name?: string;
}
const PerformerScrapeModal: React.FC<IProps> = ({
  scraper,
  name,
  onHide,
  onSelectPerformer,
}) => {
  const intl = useIntl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string>(name ?? "");
  const { data, loading } = useScrapePerformerList(scraper.id, query);

  const performers = data?.scrapeSinglePerformer ?? [];

  const onInputChange = useDebounce(setQuery, 500);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <ModalComponent
      show
      onHide={onHide}
      header={`Scrape performer from ${scraper.name}`}
      accept={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        onClick: onHide,
        variant: "secondary",
      }}
    >
      <Box>
        <TextField
          onChange={(e) => onInputChange(e.target.value)}
          defaultValue={name ?? ""}
          placeholder="Performer name..."
          sx={{ mb: 2 }}
          inputRef={inputRef}
          fullWidth
          size="small"
        />
        {loading ? (
          <Box sx={{ m: 4, textAlign: "center" }}>
            <LoadingIndicator inline />
          </Box>
        ) : (
          <Box
            component="ul"
            sx={{
              listStyle: "none",
              maxHeight: "50vh",
              overflowX: "hidden",
              overflowY: "auto",
              p: 0,
              m: 0,
              "& li": {
                width: "100%"
              },
              "& button": {
                width: "100%",
                justifyContent: "flex-start",
                textAlign: "left"
              }
            }}
          >
            {performers.map((p, i) => (
              <Box component="li" key={i}>
                <Button
                  variant="text"
                  onClick={() => onSelectPerformer(p, scraper)}
                >
                  {p.name}
                  {p.disambiguation && ` (${p.disambiguation})`}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </ModalComponent>
  );
};

export default PerformerScrapeModal;
