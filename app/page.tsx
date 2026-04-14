import Image from "next/image";

import { QuoteTransformer } from "@/components/quote-transformer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#efe6d7_0%,_#f7f4ed_34%,_#f3efe6_60%,_#ebe5d8_100%)] px-6 py-10 text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex rounded-[2rem] border border-border/70 bg-background/85 px-6 py-6 shadow-[0_30px_120px_-45px_rgba(12,25,45,0.38)] backdrop-blur md:px-8">
          <div className="flex items-center gap-4">
            <Image
              src="/onepoint-logo.webp"
              alt="OnePoint Insurance Agency"
              width={180}
              height={51}
              priority
            />
          </div>
        </header>

        <QuoteTransformer />
      </div>
    </main>
  );
}
