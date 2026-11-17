import type { ReactNode } from "react";

export const Page = ({
  subject,
  children,
}: {
  subject: ReactNode;
  children: ReactNode;
}) => (
  <main className="flex flex-col gap-4 px-4 pt-2 pb-16 sm:px-5 lg:flex-row lg:items-start lg:gap-12 lg:px-6 lg:pt-19">
    <div className="flex w-full min-w-0 flex-col lg:w-130 lg:shrink-0">
      {children}
    </div>
    <div className="order-first w-56 self-center lg:order-none lg:w-auto lg:max-w-140 lg:flex-1 lg:self-start lg:pt-6">
      {subject}
    </div>
  </main>
);
