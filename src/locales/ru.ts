import type { Translation } from './en';

export const ru: Translation = {
    // Sidebar
    servers: 'Серверы',
    add: 'Добавить',
    individualServers: 'Отдельные серверы',

    // Connection Panel
    notConnected: 'Не подключено',
    selectServer: 'Выберите сервер для подключения',
    connect: 'Подключить',
    disconnect: 'Отключить',
    connecting: 'Подключение...',
    connected: 'Подключено',
    ping: 'Пинг',
    serverInfo: 'Информация о сервере',
    prodBy: 'prod by Vlyne <3',

    // Add Modal
    addServer: 'Добавить сервер',
    addSubscription: 'Добавить подписку',
    subscriptionName: 'Название подписки (необязательно)',
    subscriptionUrl: 'URL подписки',
    configurationLink: 'Ссылка на конфигурацию',
    detectedSubscription: 'Обнаружено: URL подписки (будет импортировано несколько серверов)',
    detectedServer: 'Обнаружено: Конфигурация одного сервера',
    cancel: 'Отмена',
    adding: 'Добавление...',

    // Settings Tabs
    settings: 'Настройки',
    general: 'Общие',
    inbound: 'Inbound',
    routing: 'Routing',
    dns: 'DNS',
    core: 'Core',
    advanced: 'Расширенные',
    logs: 'Логи',

    // Logs Tab
    clearLogs: 'Очистить логи',
    copyLogs: 'Копировать логи',
    noLogs: 'Нет доступных логов',

    // General Settings
    autoConnect: 'Автоподключение',
    autoConnectDesc: 'Автоматически подключаться к последнему серверу при запуске',
    autoEnableProxy: 'Автовключение прокси',
    autoEnableProxyDesc: 'Автоматически включать системный прокси при подключении',
    minimizeToTray: 'Сворачивать в трей',
    minimizeToTrayDesc: 'Оставлять работающим в системном трее при закрытии окна',
    language: 'Язык',
    languageDesc: 'Язык приложения',

    // Inbound Settings
    socksPort: 'SOCKS порт',
    socksPortDesc: 'Локальный порт SOCKS5 прокси',
    httpPort: 'HTTP порт',
    httpPortDesc: 'Локальный порт HTTP прокси',
    allowLan: 'Разрешить LAN',
    allowLanDesc: 'Разрешить подключения из локальной сети',
    udpSupport: 'Поддержка UDP',
    udpSupportDesc: 'Включить перенаправление UDP трафика',
    trafficSniffing: 'Traffic Sniffing',
    trafficSniffingDesc: 'Включить определение протокола и маршрутизацию',

    // Routing Settings
    routingMode: 'Режим маршрутизации',
    routingModeDesc: 'Как должен маршрутизироваться трафик',
    domainStrategy: 'Domain Strategy',
    domainStrategyDesc: 'Как разрешать доменные имена',
    global: 'Global',
    bypassLan: 'Bypass LAN',
    bypassChina: 'Bypass China',
    custom: 'Custom',
    asIs: 'AsIs',
    ipIfNonMatch: 'IPIfNonMatch',
    ipOnDemand: 'IPOnDemand',

    // Advanced Settings
    multiplexing: 'Multiplexing (Mux)',
    enableMux: 'Включить Mux',
    enableMuxDesc: 'Мультиплексировать соединения для лучшей производительности',
    concurrency: 'Concurrency',
    concurrencyDesc: 'Количество параллельных соединений',
    fragment: 'Fragment',
    enableFragment: 'Включить Fragment',
    enableFragmentDesc: 'Фрагментировать пакеты для обхода DPI',
    packets: 'Packets',
    packetsDesc: 'Пакеты для фрагментации (например, tlshello)',
    length: 'Length',
    lengthDesc: 'Диапазон длины фрагментов (например, 100-200)',
    interval: 'Interval',
    intervalDesc: 'Диапазон интервала фрагментов (например, 10-20)',
    maxConnections: 'Макс. соединений',
    maxConnectionsDesc: 'Максимальное число соединений (0 - без лимита)',
    connectionTimeout: 'Тайм-аут соединения',
    connectionTimeoutDesc: 'Тайм-аут подключения в секундах',

    // DNS Settings Details
    primaryDns: 'Основной DNS',
    primaryDnsDesc: 'IP основного DNS сервера',
    fallbackDns: 'Резервный DNS',
    fallbackDnsDesc: 'IP резервного DNS сервера',
    dnsStrategy: 'Стратегия DNS',
    dnsStrategyDesc: 'Как опрашивать DNS серверы',
    useIp: 'Use IP',
    useIpv4: 'Use IPv4',
    useIpv6: 'Use IPv6',

    // Core Settings Details
    logLevel: 'Уровень логов',
    logLevelDesc: 'Уровень логирования ядра Xray',
    accessLog: 'Лог доступа',
    accessLogDesc: 'Включить лог доступа',
    errorLog: 'Лог ошибок',
    errorLogDesc: 'Включить лог ошибок',
    enableStats: 'Включить статистику',
    enableStatsDesc: 'Включить статистику трафика',

    resetToDefault: 'Сбросить по умолчанию',
    done: 'Готово',

    // Confirmations
    deleteServer: 'Удалить',
    deleteSubscription: 'Удалить подписку',
    deleteSubscriptionConfirm: 'и все её серверы?',
    resetSettingsConfirm: 'Сбросить все настройки по умолчанию?',

    // Errors
    invalidLink: 'Неверная ссылка на конфигурацию. Поддерживаемые форматы: vless://, vmess://, trojan://, ss://',
    failedToFetch: 'Не удалось загрузить подписку',
    enterLinkOrUrl: 'Пожалуйста, введите ссылку на конфигурацию или URL подписки',

    // Updates
    applicationVersion: 'Версия приложения',
    currentVersion: 'Текущая версия',
    latestVersionInstalled: 'Установлена последняя версия',
    versionAvailable: 'Доступна версия {{version}}',
    checkError: 'Ошибка проверки',
    errorPrefix: 'Ошибка: ',
    checkForUpdates: 'Проверить обновления',
    updateAvailable: 'Доступно обновление',
    newVersionAvailable: 'Новая версия {{version}} доступна для скачивания.',
    updateReadyToInstall: 'Обновление загружено и готово к установке.',
    updateQuestion: 'Хотите обновить приложение сейчас?',
    later: 'Позже',
    restartAndUpdate: 'Перезапустить и обновить',
    downloading: 'Скачивание...',
    update: 'Обновить',
    downloadStartError: 'Не удалось начать загрузку',
    installError: 'Не удалось установить обновление',
};
