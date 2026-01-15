import { Button, Menu, MenuItem, IconButton } from "@mui/material";
import { ExternalLink } from "./ExternalLink";
import TextUtils from "src/utils/text";
import { Icon } from "./Icon";
import { IconDefinition, faLink } from "@fortawesome/free-solid-svg-icons";
import { useMemo, useState } from "react";
import { faInstagram, faTwitter } from "@fortawesome/free-brands-svg-icons";
import { PatchComponent } from "src/patch";

export const ExternalLinksButton: React.FC<{
  icon?: IconDefinition;
  urls: string[];
  className?: string;
  openIfSingle?: boolean;
}> = PatchComponent(
  "ExternalLinksButton",
  ({ urls, icon = faLink, className = "", openIfSingle = false }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    if (!urls.length) {
      return null;
    }

    if (openIfSingle && urls.length === 1) {
      return (
        <ExternalLink
          className={`external-links-button-link minimal btn link ${className}`}
          href={TextUtils.sanitiseURL(urls[0])}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon icon={icon} />
        </ExternalLink>
      );
    } else {
      return (
        <>
          <IconButton
            className={`minimal link ${className}`}
            onClick={handleClick}
            size="small"
          >
            <Icon icon={icon} />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            className="external-links-button"
          >
            {urls.map((url) => (
              <MenuItem
                key={url}
                component={ExternalLink}
                href={TextUtils.sanitiseURL(url)}
                title={url}
                onClick={handleClose}
              >
                {url}
              </MenuItem>
            ))}
          </Menu>
        </>
      );
    }
  }
);

export const ExternalLinkButtons: React.FC<{ urls: string[] | undefined }> =
  PatchComponent("ExternalLinkButtons", ({ urls }) => {
    const urlSpecs = useMemo(() => {
      if (!urls?.length) {
        return [];
      }

      const twitter = urls.filter((u) =>
        u.match(/https?:\/\/(?:www\.)?(?:twitter|x).com\//)
      );
      const instagram = urls.filter((u) =>
        u.match(/https?:\/\/(?:www\.)?instagram.com\//)
      );
      const others = urls.filter(
        (u) => !twitter.includes(u) && !instagram.includes(u)
      );

      return [
        { icon: faLink, className: "", urls: others },
        { icon: faTwitter, className: "twitter", urls: twitter },
        { icon: faInstagram, className: "instagram", urls: instagram },
      ];
    }, [urls]);

    return (
      <>
        {urlSpecs.map((spec, i) => (
          <ExternalLinksButton key={i} {...spec} />
        ))}
      </>
    );
  });
