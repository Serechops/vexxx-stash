import React, { useState, useRef, useEffect } from "react";
import Button, { ButtonProps } from "@mui/material/Button";
import Box from "@mui/material/Box";
import { LoadingIndicator } from "./LoadingIndicator";

export interface IOperationButton extends ButtonProps {
  operation?: () => Promise<void>;
  loading?: boolean;
  hideChildrenWhenLoading?: boolean;
  setLoading?: (v: boolean) => void;
}

export const OperationButton: React.FC<IOperationButton> = (props) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const mounted = useRef(false);

  const {
    operation,
    loading: externalLoading,
    hideChildrenWhenLoading = false,
    setLoading: setExternalLoading,
    ...withoutExtras
  } = props;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setLoading = setExternalLoading || setInternalLoading;
  const loading =
    externalLoading !== undefined ? externalLoading : internalLoading;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (operation && !loading) {
      setLoading(true);
      await operation();

      if (mounted.current) {
        setLoading(false);
      }
    }
    if (props.onClick) {
      props.onClick(event);
    }
  }

  return (
    <Button
      variant="contained"
      onClick={handleClick}
      disabled={loading || props.disabled}
      {...withoutExtras}
    >
      {loading && (
        <Box component="span" sx={{ mr: 1, display: "flex", alignItems: "center" }}>
          <LoadingIndicator message="" inline small />
        </Box>
      )}
      {(!loading || !hideChildrenWhenLoading) && props.children}
    </Button>
  );
};
