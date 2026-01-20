import React from "react";

type IExternalLinkProps = JSX.IntrinsicElements["a"];

export const ExternalLink = React.forwardRef<HTMLAnchorElement, IExternalLinkProps>(
  (props, ref) => {
    return <a ref={ref} target="_blank" rel="noopener noreferrer" {...props} />;
  }
);
ExternalLink.displayName = "ExternalLink";
