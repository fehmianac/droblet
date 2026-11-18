import { dictionaries, languages } from '@/i18n';

// out/404.html — the S3 error document. No language in the URL is known here, so every language is shown.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-6 rounded-xl border border-line bg-white p-8 text-center shadow-sm">
        {languages.map((lang) => (
          <div key={lang} lang={lang}>
            <h1 className="text-lg font-semibold">{dictionaries[lang].notFound.title}</h1>
            <p className="mt-1 text-sm text-muted">{dictionaries[lang].notFound.body}</p>
            <a href={`/${lang}/`} className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline">
              {dictionaries[lang].notFound.home}
            </a>
          </div>
        ))}
      </div>
    </main>
  );
}
