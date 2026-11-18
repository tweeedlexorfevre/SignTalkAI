import { useLocale } from '../locale';
import labels from '../../public/models/krsl/labels.json';
import { setRecognitionPreferences } from '../recognition/preferences';
import { LiveHand } from '../components/brand/LiveHand';
export default function GesturePage() {
  const { lang, t } = useLocale();
  return (
    <>
      <p className="page-intro">
        {t(
          'Общий словарь KRSL: 10 жестов с одинаковыми названиями для локальной модели и облачного режима «KRSL · 10 жестов». Русский и казахский — языки подписи, жестовый язык остаётся KRSL.',
          'Ортақ KRSL сөздігі: жергілікті модель мен «KRSL · 10 ым» бұлт режиміне бірдей атаулары бар 10 ым. Орыс және қазақ — жазу тілдері, ым тілі KRSL болып қалады.',
        )}
      </p>
      <ul className="vocabulary-grid">
        {labels.map((l, i) => (
          <li key={l.id} data-hover>
            <span className="vocab-top">
              <span>{String(i + 1).padStart(2, '0')}</span>
              <span>{l.id}</span>
            </span>
            <span className="vocab-mark">
              <LiveHand replayOnHover />
            </span>
            <b>{l[lang]}</b>
            <small>{l[lang === 'ru' ? 'kk' : 'ru']}</small>
          </li>
        ))}
      </ul>
      <h2 className="examples-heading">
        {t('Три видео движения от авторов KRSL20', 'KRSL20 авторларының үш қимыл бейнесі')}
      </h2>
      <div className="example-grid">
        {[
          { id: 'kuda', ru: 'Куда', kk: 'Қайда' },
          { id: 'skolko', ru: 'Сколько', kk: 'Қанша' },
          { id: 'kotoriy', ru: 'Который', kk: 'Қайсы' },
        ].map((item) => (
          <article className="content-card" key={item.id}>
            <h2>{item[lang]}</h2>
            <p>
              {t(
                'Посмотрите движение в оригинальном примере KRSL20.',
                'KRSL20 бастапқы мысалындағы қимылды қараңыз.',
              )}
            </p>
            <a
              className="text-link"
              href={`https://raw.githubusercontent.com/krslproject/krsl20/master/${item.id}.gif`}
              target="_blank"
              rel="noreferrer"
            >
              {t('Открыть пример ↗', 'Мысалды ашу ↗')}
            </a>
            <a
              className="text-link example-recognize"
              href="#recognition"
              onClick={() => {
                setRecognitionPreferences({
                  signLanguage: 'krsl',
                  engine: 'cloud',
                  vocabulary: 'krsl10',
                });
              }}
            >
              {t('Попробовать распознать', 'Танып көру')} →
            </a>
          </article>
        ))}
      </div>
      <p className="page-intro">
        {t('Примеры опубликованы авторами', 'Мысалдарды жариялаған авторлар')}:{' '}
        <a href="https://krslproject.github.io/krsl20/" target="_blank" rel="noreferrer">
          KRSL20
        </a>
        .{' '}
        {t(
          'Эти три видео — примеры для человека. Они не передаются ИИ как обучение. Контрольная запись ниже проверяет локальную модель по сохранённым координатам; она не проверяет облако или вашу камеру.',
          'Бұл үш бейне — адамға арналған мысалдар. Олар ЖИ-ге оқыту ретінде жіберілмейді. Төмендегі бақылау жазбасы жергілікті модельді сақталған координаттармен тексереді; бұлтты не камераңызды тексермейді.',
        )}
      </p>
    </>
  );
}
