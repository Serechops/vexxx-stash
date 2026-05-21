import React, { useState } from "react";
import { FormattedMessage } from "react-intl";
import { Box, Divider, Typography } from "@mui/material";
import { FileBrowserTree } from "./FileBrowserTree";
import { FileBrowserContent } from "./FileBrowserContent";
import { FileBrowserBreadcrumb } from "./FileBrowserBreadcrumb";

const FileBrowser: React.FC = () => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 3.4rem)", overflow: "hidden", mx: "-15px" }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Typography variant="h5">
          <FormattedMessage id="file-browser" defaultMessage="File Browser" />
        </Typography>
      </Box>

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: Folder tree */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            overflow: "auto",
            borderRight: 1,
            borderColor: "divider",
          }}
        >
          <FileBrowserTree
            selectedId={selectedFolderId}
            onSelect={setSelectedFolderId}
          />
        </Box>

        {/* Right: Content panel */}
        <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {selectedFolderId && (
            <>
              <Box sx={{ px: 2, pt: 1.5, flexShrink: 0 }}>
                <FileBrowserBreadcrumb
                  folderId={selectedFolderId}
                  onNavigate={setSelectedFolderId}
                />
              </Box>
              <Divider />
            </>
          )}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {selectedFolderId ? (
              <FileBrowserContent
                key={selectedFolderId}
                folderId={selectedFolderId}
              />
            ) : (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "text.secondary",
                }}
              >
                <Typography variant="body1">
                  <FormattedMessage
                    id="file-browser.select_folder"
                    defaultMessage="Select a folder to view its contents"
                  />
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default FileBrowser;

