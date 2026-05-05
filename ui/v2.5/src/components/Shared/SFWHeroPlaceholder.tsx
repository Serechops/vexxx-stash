import React from "react";
import { EyeOff } from "lucide-react";
import { FormattedMessage } from "react-intl";

interface ISFWHeroPlaceholderProps {
    /** Override the outer container className. Must include positioning, sizing and background. */
    className?: string;
}

/**
 * Shown in place of hero banner components when SFW Content Mode is active.
 * The className prop controls the outer container so each hero can match its
 * original positioning and dimensions.
 */
export const SFWHeroPlaceholder: React.FC<ISFWHeroPlaceholderProps> = ({ className }) => {
    return (
        <div className={className ?? "fixed top-0 left-0 w-screen h-screen z-0 hidden md:block bg-black"}>
            <div className="flex flex-col items-center justify-center w-full h-full gap-3 pointer-events-none select-none">
                <EyeOff className="w-10 h-10 text-white/15" />
                <span className="text-xs font-semibold tracking-[0.2em] uppercase text-white/15">
                    <FormattedMessage id="config.ui.sfw_hero_hidden" defaultMessage="Content hidden" />
                </span>
            </div>
        </div>
    );
};
