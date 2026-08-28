// YawaMetrics — settings screen implementation.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "settings_widget.hpp"

#include <QApplication>
#include <QButtonGroup>
#include <QClipboard>
#include <QComboBox>
#include <QFormLayout>
#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QSlider>
#include <QTabWidget>
#include <QTimer>
#include <QToolButton>
#include <QUrlQuery>
#include <QVBoxLayout>

#include <cmath>

#include "widgets.hpp"

namespace yawametrics {

namespace {

constexpr int kWidgetStyleCount = 6;
constexpr int kWidgetAccentCount = 5;

const QStringList kWidgetStyles = {
    QStringLiteral("panel"),  QStringLiteral("stack"), QStringLiteral("badge"),
    QStringLiteral("cards"),  QStringLiteral("minimal"), QStringLiteral("ticker"),
};

const QStringList kWidgetAccents = {
    QStringLiteral("violet"), QStringLiteral("emerald"), QStringLiteral("sunset"),
    QStringLiteral("ice"), QStringLiteral("mono"),
};

const char* kWidgetStyleKeys[kWidgetStyleCount] = {
    "Widget.Style.Panel", "Widget.Style.Stack", "Widget.Style.Badge",
    "Widget.Style.Cards", "Widget.Style.Minimal", "Widget.Style.Ticker",
};

const char* kWidgetAccentKeys[kWidgetAccentCount] = {
    "Widget.Accent.Violet", "Widget.Accent.Emerald", "Widget.Accent.Sunset",
    "Widget.Accent.Ice", "Widget.Accent.Mono",
};

const char* kPlatformUrlParam[kPlatformCount] = { "vk", "tw", "yt", "tt", "kc", "gg" };

int widgetStyleIndex(const QString& style)
{
    const int index = static_cast<int>(kWidgetStyles.indexOf(style));
    return index < 0 ? 0 : index;
}

int widgetAccentIndex(const QString& accent)
{
    const int index = static_cast<int>(kWidgetAccents.indexOf(accent));
    return index < 0 ? 0 : index;
}

} // namespace

// ---------------------------------------------------------------------------
// WidgetSettings
// ---------------------------------------------------------------------------

QJsonObject WidgetSettings::toJson() const
{
    QJsonObject object;
    object.insert(QStringLiteral("style"), style);
    object.insert(QStringLiteral("accent"), accent);
    object.insert(QStringLiteral("bgOpacity"), bgOpacity);
    object.insert(QStringLiteral("radius"), radius);
    object.insert(QStringLiteral("scale"), scale);
    object.insert(QStringLiteral("blur"), blur);
    object.insert(QStringLiteral("tiles"), tiles);
    object.insert(QStringLiteral("total"), total);
    object.insert(QStringLiteral("names"), names);
    object.insert(QStringLiteral("title"), title);
    object.insert(QStringLiteral("anim"), anim);
    return object;
}

WidgetSettings WidgetSettings::fromJson(const QJsonObject& object)
{
    WidgetSettings settings;
    if (kWidgetStyles.contains(object.value(QStringLiteral("style")).toString()))
        settings.style = object.value(QStringLiteral("style")).toString();
    if (kWidgetAccents.contains(object.value(QStringLiteral("accent")).toString()))
        settings.accent = object.value(QStringLiteral("accent")).toString();

    const auto clampInt = [&object](const char* key, int fallback, int lo, int hi) {
        const QJsonValue value = object.value(QLatin1String(key));
        if (!value.isDouble())
            return fallback;
        const int number = static_cast<int>(value.toDouble());
        return (number >= lo && number <= hi) ? number : fallback;
    };
    settings.bgOpacity = clampInt("bgOpacity", 100, 0, 100);
    settings.radius = clampInt("radius", 12, 0, 32);
    settings.scale = clampInt("scale", 100, 75, 160);
    settings.blur = object.value(QStringLiteral("blur")).toBool(true);
    settings.tiles = object.value(QStringLiteral("tiles")).toBool(true);
    settings.total = object.value(QStringLiteral("total")).toBool(true);
    settings.names = object.value(QStringLiteral("names")).toBool(true);
    settings.title = object.value(QStringLiteral("title")).toBool(false);
    settings.anim = object.value(QStringLiteral("anim")).toBool(true);
    return settings;
}

WidgetSettings WidgetSettings::load()
{
    return WidgetSettings::fromJson(loadAuxJson(QStringLiteral("widget.json")));
}

void WidgetSettings::save() const
{
    saveAuxJson(QStringLiteral("widget.json"), toJson());
}

QString buildWidgetUrl(const QString& widgetFilePath, const AppConfig& config,
                       const WidgetSettings& widgetSettings)
{
    if (widgetFilePath.isEmpty())
        return QString();

    QUrlQuery query;
    query.addQueryItem(QStringLiteral("style"), widgetSettings.style);
    query.addQueryItem(QStringLiteral("accent"), widgetSettings.accent);
    query.addQueryItem(QStringLiteral("bg"), QString::number(widgetSettings.bgOpacity));
    query.addQueryItem(QStringLiteral("radius"), QString::number(widgetSettings.radius));
    query.addQueryItem(QStringLiteral("scale"), QString::number(widgetSettings.scale));
    query.addQueryItem(QStringLiteral("blur"), widgetSettings.blur
                                             ? QStringLiteral("1")
                                             : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("tiles"), widgetSettings.tiles
                                                  ? QStringLiteral("1")
                                                  : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("total"), widgetSettings.total
                                                  ? QStringLiteral("1")
                                                  : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("names"), widgetSettings.names
                                                  ? QStringLiteral("1")
                                                  : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("title"), widgetSettings.title
                                                  ? QStringLiteral("1")
                                                  : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("anim"), widgetSettings.anim
                                                 ? QStringLiteral("1")
                                                 : QStringLiteral("0"));
    query.addQueryItem(QStringLiteral("interval"), QString::number(config.pollIntervalSec));

    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        const QString channel = normalizeChannel(id, config.platforms[i].channel);
        if (!channel.isEmpty())
            query.addQueryItem(QLatin1String(kPlatformUrlParam[i]), channel);
    }

    QUrl url = QUrl::fromLocalFile(widgetFilePath);
    url.setQuery(query);
    return url.toString(QUrl::FullyEncoded);
}

// ---------------------------------------------------------------------------
// SettingsWidget
// ---------------------------------------------------------------------------

SettingsWidget::SettingsWidget(QWidget* parent)
    : QWidget(parent)
{
    setObjectName(QStringLiteral("SettingsRoot"));
    m_widgetSettings = WidgetSettings::load();

    auto* rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(10, 10, 10, 10);
    rootLayout->setSpacing(8);

    auto* tabs = new QTabWidget(this);
    tabs->addTab(createGeneralTab(), ymtr(QStringLiteral("Settings.Tab.General")));
    tabs->addTab(createPlatformsTab(), ymtr(QStringLiteral("Settings.Tab.Platforms")));
    tabs->addTab(createWidgetTab(), ymtr(QStringLiteral("Settings.Tab.Widget")));
    rootLayout->addWidget(tabs, 1);

    auto* bottomLayout = new QHBoxLayout;
    bottomLayout->setContentsMargins(0, 0, 0, 0);
    bottomLayout->addStretch(1);
    auto* backButton = new QPushButton(ymtr(QStringLiteral("Settings.Back")), this);
    backButton->setObjectName(QStringLiteral("SecondaryButton"));
    connect(backButton, &QPushButton::clicked, this, &SettingsWidget::closeRequested);
    bottomLayout->addWidget(backButton);
    rootLayout->addLayout(bottomLayout);
}

void SettingsWidget::setEngine(PollEngine* engine)
{
    m_engine = engine;
    if (m_engine) {
        connect(m_engine, &PollEngine::testFinished, this, &SettingsWidget::onTestFinished);
    }
}

void SettingsWidget::setWidgetFilePath(const QString& filePath)
{
    m_widgetFilePath = filePath;
    refreshWidgetUrl();
}

// ---------------------------------------------------------------------------
// Общие
// ---------------------------------------------------------------------------

QWidget* SettingsWidget::createGeneralTab()
{
    auto* page = new QWidget(this);
    auto* form = new QFormLayout(page);
    form->setContentsMargins(12, 12, 12, 12);
    form->setSpacing(10);
    form->setLabelAlignment(Qt::AlignLeft | Qt::AlignVCenter);

    m_intervalCombo = new QComboBox(page);
    fillIntervalCombo();
    form->addRow(ymtr(QStringLiteral("Settings.Interval")), m_intervalCombo);

    m_modeCombo = new QComboBox(page);
    m_modeCombo->addItem(ymtr(QStringLiteral("Settings.Mode.Full")), QVariant(false));
    m_modeCombo->addItem(ymtr(QStringLiteral("Settings.Mode.Compact")), QVariant(true));
    form->addRow(ymtr(QStringLiteral("Settings.Mode")), m_modeCombo);

    m_showTitleSwitch = new SwitchBox(page);
    form->addRow(ymtr(QStringLiteral("Settings.ShowTitle")), m_showTitleSwitch);

    m_autoStartSwitch = new SwitchBox(page);
    form->addRow(ymtr(QStringLiteral("Settings.AutoStart")), m_autoStartSwitch);

    m_fullScaleCombo = new QComboBox(page);
    m_fullScaleCombo->addItem(QStringLiteral("85 %"), QVariant(85));
    m_fullScaleCombo->addItem(QStringLiteral("100 %"), QVariant(100));
    m_fullScaleCombo->addItem(QStringLiteral("120 %"), QVariant(120));
    m_fullScaleCombo->addItem(QStringLiteral("140 %"), QVariant(140));
    form->addRow(ymtr(QStringLiteral("Settings.FullScale")), m_fullScaleCombo);

    m_compactScaleCombo = new QComboBox(page);
    for (double scale = 0.75; scale <= 1.301; scale += 0.05) {
        m_compactScaleCombo->addItem(QString::number(scale, 'f', 2) + QStringLiteral("×"),
                                     QVariant(scale));
    }
    form->addRow(ymtr(QStringLiteral("Settings.CompactScale")), m_compactScaleCombo);

    m_hideNamesSwitch = new SwitchBox(page);
    form->addRow(ymtr(QStringLiteral("Settings.HideNames")), m_hideNamesSwitch);

    connect(m_intervalCombo, &QComboBox::currentIndexChanged, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_modeCombo, &QComboBox::currentIndexChanged, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_showTitleSwitch, &SwitchBox::toggled, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_autoStartSwitch, &SwitchBox::toggled, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_fullScaleCombo, &QComboBox::currentIndexChanged, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_compactScaleCombo, &QComboBox::currentIndexChanged, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_hideNamesSwitch, &SwitchBox::toggled, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });

    return page;
}

void SettingsWidget::fillIntervalCombo()
{
    if (m_intervalCombo->count() > 0)
        return;
    for (int seconds = 10; seconds <= 120; seconds += 5)
        m_intervalCombo->addItem(QStringLiteral("%1 с").arg(seconds), QVariant(seconds));
}

// ---------------------------------------------------------------------------
// Площадки
// ---------------------------------------------------------------------------

QWidget* SettingsWidget::createPlatformsTab()
{
    auto* page = new QWidget(this);
    auto* rootLayout = new QVBoxLayout(page);
    rootLayout->setContentsMargins(12, 12, 12, 12);
    rootLayout->setSpacing(10);

    // Выбор площадки
    auto* platformRow = new QHBoxLayout;
    platformRow->setSpacing(6);
    m_platformButtons = new QButtonGroup(this);
    m_platformButtons->setExclusive(true);
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        auto* button = new QToolButton(page);
        button->setCheckable(true);
        button->setToolButtonStyle(Qt::ToolButtonTextUnderIcon);
        button->setIconSize(QSize(20, 20));
        button->setIcon(renderBrandIcon(id, 20));
        button->setText(platformShortCode(id));
        button->setObjectName(QStringLiteral("PlatformButton"));
        button->setToolTip(platformDisplayName(id));
        m_platformButtons->addButton(button, i);
        m_platformToolButtons[i] = button;
        platformRow->addWidget(button, 1);
    }
    m_platformToolButtons[0]->setChecked(true);
    connect(m_platformButtons, &QButtonGroup::idClicked, this, [this](int index) {
        if (index >= 0 && index < kPlatformCount)
            showPlatform(kPlatformOrder[index]);
    });
    rootLayout->addLayout(platformRow);

    // Панель площадки
    auto* panel = new QFrame(page);
    panel->setObjectName(QStringLiteral("SettingsPanel"));
    auto* form = new QFormLayout(panel);
    m_platformForm = form;
    form->setContentsMargins(12, 12, 12, 12);
    form->setSpacing(10);

    m_enabledSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Settings.Enabled")), m_enabledSwitch);

    m_channelEdit = new QLineEdit(panel);
    m_channelEdit->setPlaceholderText(platformPlaceholder(PlatformId::Vk));
    form->addRow(ymtr(QStringLiteral("Settings.Channel")), m_channelEdit);

    m_hintLabel = new QLabel(panel);
    m_hintLabel->setObjectName(QStringLiteral("HintLabel"));
    m_hintLabel->setWordWrap(true);
    form->addRow(QString(), m_hintLabel);

    m_revealKeysButton = new QPushButton(panel);
    m_revealKeysButton->setObjectName(QStringLiteral("SecondaryButton"));
    m_revealKeysButton->setCheckable(true);
    form->addRow(QString(), m_revealKeysButton);

    m_keyEdit = new QLineEdit(panel);
    m_keyEdit->setEchoMode(QLineEdit::Password); // ФТ-5.13
    m_keyEdit->setPlaceholderText(ymtr(QStringLiteral("Settings.KeyPlaceholder")));
    form->addRow(ymtr(QStringLiteral("Settings.Key")), m_keyEdit);

    m_secretEdit = new QLineEdit(panel);
    m_secretEdit->setEchoMode(QLineEdit::Password); // ФТ-5.13
    m_secretEdit->setPlaceholderText(ymtr(QStringLiteral("Settings.SecretPlaceholder")));
    form->addRow(ymtr(QStringLiteral("Settings.Secret")), m_secretEdit);

    m_testButton = new QPushButton(ymtr(QStringLiteral("Settings.Test")), panel);
    m_testButton->setObjectName(QStringLiteral("PrimaryButton"));
    form->addRow(QString(), m_testButton);

    m_testResultLabel = new QLabel(panel);
    m_testResultLabel->setWordWrap(true);
    form->addRow(QString(), m_testResultLabel);

    rootLayout->addWidget(panel);
    rootLayout->addStretch(1);

    // Секреты скрыты, пока пользователь не нажмёт кнопку (ФТ-5.14).
    connect(m_revealKeysButton, &QPushButton::toggled, this, [this]() {
        refreshHintLabel();
        emitConfig();
    });
    connect(m_enabledSwitch, &SwitchBox::toggled, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_channelEdit, &QLineEdit::textEdited, this, [this]() {
        refreshHintLabel();
        emitConfig();
    });
    connect(m_keyEdit, &QLineEdit::textEdited, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_secretEdit, &QLineEdit::textEdited, this, [this]() {
        if (!m_syncing)
            emitConfig();
    });
    connect(m_testButton, &QPushButton::clicked, this, [this]() {
        if (m_engine)
            m_engine->testPlatform(m_currentPlatform);
        m_testResultLabel->setText(ymtr(QStringLiteral("Test.Running")));
        m_testResultLabel->setStyleSheet(QStringLiteral("color:#8b91a8;"));
    });

    syncPlatformPanel();
    return page;
}

void SettingsWidget::showPlatform(PlatformId id)
{
    m_currentPlatform = id;
    syncPlatformPanel();
}

void SettingsWidget::syncPlatformPanel()
{
    m_syncing = true;

    const PlatformSettings& ps = m_config.platform(m_currentPlatform);
    const int index = static_cast<int>(m_currentPlatform);

    m_channelEdit->setPlaceholderText(platformPlaceholder(m_currentPlatform));
    m_channelEdit->setText(ps.channel);
    m_enabledSwitch->setChecked(ps.enabled);
    m_keyEdit->setText(ps.key);
    m_secretEdit->setText(ps.secret);

    // ФТ-5.14: поля ключей скрыты, пока пользователь не попросит.
    const bool revealed = m_revealKeysButton->isChecked() || !ps.key.isEmpty() || !ps.secret.isEmpty();
    m_revealKeysButton->setChecked(revealed);
    m_revealKeysButton->setText(ymtr(revealed
                                         ? QStringLiteral("Settings.KeysHide")
                                         : QStringLiteral("Settings.KeysReveal")));
    // Строки формы скрываются целиком — вместе с подписями (ФТ-5.14).
    if (m_platformForm) {
        m_platformForm->setRowVisible(m_keyEdit, revealed);
        m_platformForm->setRowVisible(m_secretEdit, revealed);
    }
    m_keyEdit->setVisible(revealed);
    m_secretEdit->setVisible(revealed);
    m_keyEdit->setEnabled(revealed);
    m_secretEdit->setEnabled(revealed);

    // Подписи полей ключей зависят от площадки (ФТ-3.8).
    const QString keyKey = QStringLiteral("Settings.KeyLabel.") + platformIdName(m_currentPlatform);
    m_keyEdit->setToolTip(ymtr(keyKey));

    if (m_platformToolButtons[index])
        m_platformToolButtons[index]->setChecked(true);

    m_testResultLabel->setText(QString());
    refreshHintLabel();
    m_syncing = false;
}

void SettingsWidget::refreshHintLabel()
{
    const QString hint = channelHint(m_currentPlatform, m_channelEdit->text().trimmed());
    m_hintLabel->setText(hint);
}

// ---------------------------------------------------------------------------
// Виджет
// ---------------------------------------------------------------------------

QWidget* SettingsWidget::createWidgetTab()
{
    auto* page = new QWidget(this);
    auto* rootLayout = new QVBoxLayout(page);
    rootLayout->setContentsMargins(12, 12, 12, 12);
    rootLayout->setSpacing(10);

    auto* panel = new QFrame(page);
    panel->setObjectName(QStringLiteral("SettingsPanel"));
    auto* form = new QFormLayout(panel);
    form->setContentsMargins(12, 12, 12, 12);
    form->setSpacing(10);

    m_styleCombo = new QComboBox(panel);
    for (int i = 0; i < kWidgetStyles.size(); ++i)
        m_styleCombo->addItem(ymtr(QLatin1String(kWidgetStyleKeys[i])), kWidgetStyles.at(i));
    form->addRow(ymtr(QStringLiteral("Widget.Style")), m_styleCombo);

    m_accentCombo = new QComboBox(panel);
    for (int i = 0; i < kWidgetAccentCount; ++i)
        m_accentCombo->addItem(ymtr(QLatin1String(kWidgetAccentKeys[i])), kWidgetAccents.at(i));
    form->addRow(ymtr(QStringLiteral("Widget.Accent")), m_accentCombo);

    auto addSliderRow = [this, form, panel](const QString& label, QSlider** slider,
                                            QLabel** valueLabel, int lo, int hi,
                                            int defaultValue) {
        *slider = new QSlider(Qt::Horizontal, panel);
        (*slider)->setRange(lo, hi);
        (*slider)->setValue(defaultValue);
        *valueLabel = new QLabel(panel);
        auto* row = new QHBoxLayout;
        row->setContentsMargins(0, 0, 0, 0);
        row->setSpacing(8);
        row->addWidget(*slider, 1);
        row->addWidget(*valueLabel, 0, Qt::AlignVCenter);
        form->addRow(label, row);
    };

    addSliderRow(ymtr(QStringLiteral("Widget.BgOpacity")), &m_bgSlider, &m_bgValueLabel, 0, 100, 100);
    addSliderRow(ymtr(QStringLiteral("Widget.Radius")), &m_radiusSlider, &m_radiusValueLabel, 0, 32, 12);
    addSliderRow(ymtr(QStringLiteral("Widget.Scale")), &m_scaleSlider, &m_scaleValueLabel, 75, 160, 100);

    m_blurSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Blur")), m_blurSwitch);
    m_tilesSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Tiles")), m_tilesSwitch);
    m_totalSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Total")), m_totalSwitch);
    m_namesSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Names")), m_namesSwitch);
    m_titleSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Title")), m_titleSwitch);
    m_animSwitch = new SwitchBox(panel);
    form->addRow(ymtr(QStringLiteral("Widget.Anim")), m_animSwitch);

    rootLayout->addWidget(panel);

    auto* urlRow = new QHBoxLayout;
    urlRow->setSpacing(8);
    m_urlEdit = new QLineEdit(page);
    m_urlEdit->setReadOnly(true);
    m_copyUrlButton = new QPushButton(ymtr(QStringLiteral("Widget.CopyUrl")), page);
    m_copyUrlButton->setObjectName(QStringLiteral("PrimaryButton"));
    urlRow->addWidget(m_urlEdit, 1);
    urlRow->addWidget(m_copyUrlButton, 0);
    rootLayout->addLayout(urlRow);

    auto* instructions = new QLabel(ymtr(QStringLiteral("Widget.Instructions")), page);
    instructions->setObjectName(QStringLiteral("HintLabel"));
    instructions->setWordWrap(true);
    rootLayout->addWidget(instructions);
    rootLayout->addStretch(1);

    // Мгновенное применение и сохранение (ФТ-5.11, ФТ-7.10).
    connect(m_styleCombo, &QComboBox::currentIndexChanged, this, [this]() {
        saveWidgetSettings();
    });
    connect(m_accentCombo, &QComboBox::currentIndexChanged, this, [this]() {
        saveWidgetSettings();
    });
    connect(m_bgSlider, &QSlider::valueChanged, this, [this](int value) {
        m_bgValueLabel->setText(QStringLiteral("%1 %").arg(value));
        saveWidgetSettings();
    });
    connect(m_radiusSlider, &QSlider::valueChanged, this, [this](int value) {
        m_radiusValueLabel->setText(QStringLiteral("%1 px").arg(value));
        saveWidgetSettings();
    });
    connect(m_scaleSlider, &QSlider::valueChanged, this, [this](int value) {
        m_scaleValueLabel->setText(QStringLiteral("%1 %").arg(value));
        saveWidgetSettings();
    });
    connect(m_blurSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_tilesSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_totalSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_namesSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_titleSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_animSwitch, &SwitchBox::toggled, this, [this]() { saveWidgetSettings(); });
    connect(m_copyUrlButton, &QPushButton::clicked, this, [this]() {
        QClipboard* clipboard = QApplication::clipboard();
        if (clipboard && !m_urlEdit->text().isEmpty())
            clipboard->setText(m_urlEdit->text());
        m_copyUrlButton->setText(ymtr(QStringLiteral("Widget.UrlCopied")));
        QTimer::singleShot(1500, this, [this]() {
            m_copyUrlButton->setText(ymtr(QStringLiteral("Widget.CopyUrl")));
        });
    });

    syncWidgetTab();
    return page;
}

void SettingsWidget::syncWidgetTab()
{
    m_syncing = true;
    m_styleCombo->setCurrentIndex(widgetStyleIndex(m_widgetSettings.style));
    m_accentCombo->setCurrentIndex(widgetAccentIndex(m_widgetSettings.accent));
    m_bgSlider->setValue(m_widgetSettings.bgOpacity);
    m_bgValueLabel->setText(QStringLiteral("%1 %").arg(m_widgetSettings.bgOpacity));
    m_radiusSlider->setValue(m_widgetSettings.radius);
    m_radiusValueLabel->setText(QStringLiteral("%1 px").arg(m_widgetSettings.radius));
    m_scaleSlider->setValue(m_widgetSettings.scale);
    m_scaleValueLabel->setText(QStringLiteral("%1 %").arg(m_widgetSettings.scale));
    m_blurSwitch->setChecked(m_widgetSettings.blur);
    m_tilesSwitch->setChecked(m_widgetSettings.tiles);
    m_totalSwitch->setChecked(m_widgetSettings.total);
    m_namesSwitch->setChecked(m_widgetSettings.names);
    m_titleSwitch->setChecked(m_widgetSettings.title);
    m_animSwitch->setChecked(m_widgetSettings.anim);
    m_syncing = false;
    refreshWidgetUrl();
}

void SettingsWidget::saveWidgetSettings()
{
    if (m_syncing)
        return;
    m_widgetSettings.style = kWidgetStyles.at(m_styleCombo->currentIndex());
    m_widgetSettings.accent = kWidgetAccents.at(m_accentCombo->currentIndex());
    m_widgetSettings.bgOpacity = m_bgSlider->value();
    m_widgetSettings.radius = m_radiusSlider->value();
    m_widgetSettings.scale = m_scaleSlider->value();
    m_widgetSettings.blur = m_blurSwitch->isChecked();
    m_widgetSettings.tiles = m_tilesSwitch->isChecked();
    m_widgetSettings.total = m_totalSwitch->isChecked();
    m_widgetSettings.names = m_namesSwitch->isChecked();
    m_widgetSettings.title = m_titleSwitch->isChecked();
    m_widgetSettings.anim = m_animSwitch->isChecked();
    m_widgetSettings.save(); // ФТ-5.11: немедленное сохранение
    refreshWidgetUrl();
}

void SettingsWidget::refreshWidgetUrl()
{
    m_urlEdit->setText(buildWidgetUrl(m_widgetFilePath, m_config, m_widgetSettings));
}

// ---------------------------------------------------------------------------
// Общее
// ---------------------------------------------------------------------------

void SettingsWidget::openWithConfig(const AppConfig& config)
{
    m_syncing = true;
    m_config = config;

    syncGeneral(config);
    syncPlatformPanel();
    m_syncing = false;

    refreshWidgetUrl();
}

void SettingsWidget::syncGeneral(const AppConfig& config)
{
    const int intervalIndex = m_intervalCombo->findData(QVariant(config.pollIntervalSec));
    if (intervalIndex >= 0)
        m_intervalCombo->setCurrentIndex(intervalIndex);
    m_modeCombo->setCurrentIndex(config.compactMode ? 1 : 0);
    m_showTitleSwitch->setChecked(config.showStreamTitle);
    m_autoStartSwitch->setChecked(config.autoStartPolling);
    const int fullScaleIndex = m_fullScaleCombo->findData(QVariant(config.uiScalePercent));
    if (fullScaleIndex >= 0)
        m_fullScaleCombo->setCurrentIndex(fullScaleIndex);
    int compactIndex = -1;
    for (int i = 0; i < m_compactScaleCombo->count(); ++i) {
        if (std::abs(m_compactScaleCombo->itemData(i).toDouble() - config.compactScale) < 0.001) {
            compactIndex = i;
            break;
        }
    }
    if (compactIndex >= 0)
        m_compactScaleCombo->setCurrentIndex(compactIndex);
    m_hideNamesSwitch->setChecked(config.compactHideNames);
}

AppConfig SettingsWidget::gatherConfig() const
{
    AppConfig config = m_config;

    if (m_intervalCombo->currentData().isValid())
        config.pollIntervalSec = m_intervalCombo->currentData().toInt();
    config.compactMode = m_modeCombo->currentData().toBool();
    config.showStreamTitle = m_showTitleSwitch->isChecked();
    config.autoStartPolling = m_autoStartSwitch->isChecked();
    if (m_fullScaleCombo->currentData().isValid())
        config.uiScalePercent = m_fullScaleCombo->currentData().toInt();
    if (m_compactScaleCombo->currentData().isValid())
        config.compactScale = m_compactScaleCombo->currentData().toDouble();
    config.compactHideNames = m_hideNamesSwitch->isChecked();

    // Текущая площадка редактируется в её панели.
    PlatformSettings& ps = config.platform(m_currentPlatform);
    ps.enabled = m_enabledSwitch->isChecked();
    ps.channel = m_channelEdit->text().trimmed();
    ps.key = m_keyEdit->text().trimmed();
    ps.secret = m_secretEdit->text().trimmed();

    return config;
}

void SettingsWidget::emitConfig()
{
    if (m_syncing)
        return;
    m_config = gatherConfig();
    refreshHintLabel();
    refreshWidgetUrl();
    emit configSaved(m_config); // DockPanel сохранит и применит (ФТ-5.11)
}

void SettingsWidget::onTestFinished(PlatformId id, bool ok, QString message)
{
    if (id != m_currentPlatform)
        return;
    m_testResultLabel->setText(message);
    m_testResultLabel->setStyleSheet(
        QStringLiteral("color:%1;").arg(QColor(ok ? QStringLiteral("#22c55e")
                                                  : QStringLiteral("#f43f5e")).name()));
}

} // namespace yawametrics
