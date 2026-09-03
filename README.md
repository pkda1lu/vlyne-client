# Vlyne Client

Быстрый клиент для проксирования трафика в Windows. Ядро — [sing-box](https://sing-box.sagernet.org/), оболочка — [Tauri 2](https://tauri.app/) (Rust + React).

**Русский** | [English](#english)

---

## Что нового в 1.0

Версия 1.0 — полная переработка. Приложение больше не использует Electron и Xray.

| | 1.x | 1.0 |
|---|---|---|
| Оболочка | Electron | Tauri 2 (системный WebView2) |
| Ядро | Xray 25.12 | sing-box 1.14 |
| Размер установщика | ~150 МБ | 22 МБ |
| Режимы | системный прокси | системный прокси и TUN |
| Протоколы | VLESS, VMess, Trojan, Shadowsocks | плюс Hysteria2, TUIC, AnyTLS |
| Транспорты | tcp, ws, grpc, h2, quic, kcp | tcp, ws, grpc, http, httpupgrade |
| Смена сервера | перезапуск ядра | мгновенно, через selector |
| Задержка | TCP-хендшейк | реальный запрос через туннель |
| Статистика | нет | скорость, объём, время сессии |

### Исправленные дефекты

**Пропадал интернет при подключении.** Системный прокси прописывался в реестр сразу после запуска процесса ядра, без проверки, что ядро вообще поднялось. Невалидный конфиг — ядро падает через доли секунды, а прокси остаётся указывать на мёртвый порт: интернета нет, а интерфейс показывает «подключено». Теперь порядок такой:

1. конфиг генерируется и проверяется через `sing-box check`;
2. ядро запускается, и клиент ждёт, пока оно ответит на своём управляющем порту;
3. только после этого меняются настройки прокси Windows.

Любой сбой до третьего шага оставляет сеть нетронутой.

**Прокси не откатывался после аварийного завершения.** Прежние настройки теперь сохраняются на диск до изменения реестра, и при следующем запуске клиент их восстанавливает.

**Приложения не видели смену прокси.** Реестр менялся без уведомления WinInet, поэтому часть программ продолжала работать по старым настройкам. Теперь вызывается `InternetSetOption` с `INTERNET_OPTION_SETTINGS_CHANGED`.

**Рассинхрон портов.** Значение по умолчанию в хранилище (10810) не совпадало с запасным в коде (10809).

---

## Установка

Скачайте установщик со страницы [Releases](https://github.com/pkda1lu/vlyne-client/releases) и запустите его.

Обновления приходят автоматически, если они включены в настройках.

## Использование

Добавьте серверы — вставьте ссылки (`vless://`, `vmess://`, `trojan://`, `ss://`, `hysteria2://`, `tuic://`, `anytls://`) или укажите адрес подписки. Нажмите кнопку подключения.

### Режимы

**Системный прокси** — по умолчанию. Прав администратора не требует. Трафик перехватывается через настройки прокси Windows, поэтому приложения, которые их игнорируют (многие игры, торрент-клиенты, любой UDP), идут мимо туннеля.

**TUN** — виртуальный сетевой адаптер, забирающий весь трафик системы, включая UDP. Требует прав администратора: приложение предложит перезапуститься.

### Маршрутизация

Пресеты: всё через прокси, локальная сеть напрямую, российские ресурсы напрямую, только свои правила. Свои правила применяются раньше пресета. Отдельно включается блокировка рекламы и трекеров.

В разделе «Маршрутизация» можно перечислить процессы, которые никогда не заходят в туннель — это работает в режиме TUN.

### Автовыбор сервера

Ядро само измеряет задержку и держит соединение на самом быстром живом сервере. Кнопка «Проверить все» измеряет реальную задержку через туннель, когда соединение установлено, и время TCP-хендшейка, когда нет.

---

## Разработка

### Что нужно

* Node.js 20+
* Rust (stable, MSVC)
* Visual Studio Build Tools с компонентом «Разработка классических приложений на C++»
* WebView2 — уже входит в Windows 11

### Сборка

```bash
npm install
npm run core:fetch
npm run app:dev
```

`core:fetch` скачивает sing-box, wintun и наборы гео-правил в `src-tauri/binaries` и `src-tauri/resources`. Они не хранятся в репозитории; версии закреплены в `scripts/fetch-core.mjs`.

Готовый установщик:

```bash
npm run app:build
```

### Проверки

```bash
npm run check
```

Проверяет типы фронтенда и прогоняет тесты Rust. Среди них — `every_generated_config_is_accepted_by_the_core`: он берёт конфиг, который реально выдаёт генератор, для восьми протоколов и шести наборов настроек, и скармливает его настоящему `sing-box check`. Это единственный способ вовремя заметить, что новая версия ядра сменила схему; именно так обнаружилось, что в 1.14 удалён прежний формат DNS-серверов, а AnyTLS не принимает поле `multiplex`.

### Устройство

```
src/                    Интерфейс на React
  lib/ipc.ts            Типизированная обёртка над командами Tauri
  lib/store.ts          Состояние (zustand), синхронизация через события
  views/                Экраны
src-tauri/src/
  model.rs              Доменная модель: серверы, подписки, настройки
  link.rs               Разбор ссылок всех поддерживаемых схем
  singbox.rs            Генерация конфига sing-box
  core.rs               Надзор за процессом ядра
  sysproxy.rs           Системный прокси Windows через реестр и WinInet
  clash.rs              Clash API: статистика, смена узла, замеры задержки
  state.rs              Жизненный цикл соединения
  commands.rs           Команды, доступные интерфейсу
scripts/
  fetch-core.mjs        Загрузка бинарников и гео-правил
```

Все серверы попадают в конфиг сразу, под `selector`. Поэтому смена сервера — один вызов Clash API, а не перезапуск ядра, и задержку можно измерять по каждому узлу отдельно, не переподключаясь.

### Подпись обновлений

Публичный ключ лежит в `src-tauri/tauri.conf.json`. Приватный ключ и пароль к нему — вне репозитория:

* `~/.tauri/vlyne-updater.key`
* `~/.tauri/vlyne-updater.password`

Собирать нужно из PowerShell: линковщик MSVC не запускается из Git Bash.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.taurilyne-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$env:USERPROFILE\.taurilyne-updater.password" -Raw)
npm run app:build
```

Ключ защищён паролем намеренно. Пустой пароль тут не работает: PowerShell и .NET удаляют переменную окружения при присваивании пустой строки, и сборка молча зависает на запросе пароля.

Для GitHub Actions положите содержимое обоих файлов в секреты `TAURI_SIGNING_PRIVATE_KEY` и `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Потеря приватного ключа или пароля означает, что обновления перестанут устанавливаться у всех, кто уже поставил приложение: сменить ключ можно только новым установщиком.

---

<a id="english"></a>

## English

A fast proxy client for Windows, built on [sing-box](https://sing-box.sagernet.org/) and [Tauri 2](https://tauri.app/).

### What changed in 3.0

A full rewrite: no Electron, no Xray. The installer went from about 150 MB to 22 MB, TUN mode was added alongside the system proxy, and Hysteria2, TUIC and AnyTLS joined the supported protocols.

The headline fix: the old client pointed the Windows system proxy at the core the instant it spawned the process. If the configuration was bad the core died milliseconds later and the machine was left with a proxy aimed at a closed port — no internet at all, while the interface still read "connected". The order is now: validate the config with `sing-box check`, start the core, wait for it to answer on its control port, and only then touch the system proxy. Anything that fails before that last step leaves the network untouched.

Two related fixes: the previous proxy settings are written to disk before the registry is changed, so a crash cannot strand the machine, and WinInet is notified after every change, so applications actually pick it up.

### Building

```bash
npm install
npm run core:fetch
npm run app:dev
```

Requires Node 20+, Rust (stable MSVC) and the Visual Studio Build Tools C++ workload. `npm run check` runs the frontend type-check and the Rust tests, one of which validates every generated configuration against the real `sing-box` binary.

### Licence

The bundled sing-box binary is distributed under its own licence. wintun is redistributed under the terms published at [wintun.net](https://www.wintun.net/).
