import React, { PropsWithChildren } from "react";

interface IProps {
  className?: string;
  header: string;
  link: JSX.Element;
}

export const RecommendationRow: React.FC<PropsWithChildren<IProps>> = ({
  className,
  header,
  link,
  children,
}) => (
  <div className={`recommendation-row mb-8 pl-4 md:pl-12 transition-all duration-300 ${className}`}>
    <div className="recommendation-row-head flex items-center justify-between mb-2">
      <div>
        <h2 className="text-xl font-bold text-gray-200 uppercase tracking-wide drop-shadow-md">{header}</h2>
      </div>
      <div className="text-sm font-semibold text-cyan-400 hover:text-cyan-300 transition-colors mr-4 md:mr-12">
        {link}
      </div>
    </div>
    {children}
  </div>
);
