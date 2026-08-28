// YawaMetrics — settings screen.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// SettingsWidget: панель общих настроек, панель площадки и вкладка «Виджет»
// (§4.2, §3.5, §3.7). Сохранение немедленное при изменении (ФТ-5.11).

#pragma once

#include <QWidget>

#include "../config.hpp"
#include "../poll_engine.hpp"

class QButtonGroup;
class QComboBox;
class QFormLayout;
class QLabel;
class QLineEdit;
class QPushButton;
class QSlider;
class QTabWidget;
class QToolButton;

namespace yawametrics {

class SwitchBox;

// Настройки виджета (Browser Source) — кодируются в URL-параметры (ФТ-7.10).
struct WidgetSettings {
    QString style = QStringLiteral("panel");
    QString accent = QStringLiteral("violet");
    int bgOpacity = 100; // 0–100 (0 % = чистый RGBA без подложки)
    int radius = 12;     // 0–32 px
    int scale = 100;     // 75–160 %
    bool blur = true;    // backdrop-blur
    bool tiles = true;   // плитки площадок
    bool total = true;   // всего зрителей
    bool names = true;   // подписи названий
    bool title = false;  // название стрима
    bool anim = true;    // анимация

    QJsonObject toJson() const;
    static WidgetSettings fromJson(const QJsonObject& object);
    static WidgetSettings load();
    void save() const;
};

// Собирает самодостаточную ссылку на виджет с параметрами.
QString buildWidgetUrl(const QString& widgetFilePath, const AppConfig& config,
                       const WidgetSettings& widgetSettings);

class SettingsWidget : public QWidget {
    Q_OBJECT

public:
    explicit SettingsWidget(QWidget* parent = nullptr);

    void setEngine(PollEngine* engine);
    void setWidgetFilePath(const QString& filePath);

    // Синхронизировать элементы управления из конфигурации.
    void openWithConfig(const AppConfig& config);

    // Контракт §4.5: переход к настройкам конкретной площадки.
    void showPlatform(PlatformId id);

    WidgetSettings widgetSettings() const { return m_widgetSettings; }

signals:
    void configSaved(AppConfig config); // Контракт §4.5
    void closeRequested();

private slots:
    void onTestFinished(PlatformId id, bool ok, QString message); // Контракт §4.5

private:
    QWidget* createGeneralTab();
    QWidget* createPlatformsTab();
    QWidget* createWidgetTab();
    void fillIntervalCombo();
    void syncGeneral(const AppConfig& config);
    void syncPlatformPanel();
    void syncWidgetTab();
    void refreshHintLabel();
    void refreshWidgetUrl();
    void emitConfig();
    AppConfig gatherConfig() const;
    void saveWidgetSettings();

    AppConfig m_config;
    WidgetSettings m_widgetSettings;
    QString m_widgetFilePath;
    PlatformId m_currentPlatform = PlatformId::Vk;
    bool m_syncing = false;

    PollEngine* m_engine = nullptr;

    // Общие
    QComboBox* m_intervalCombo = nullptr;
    QComboBox* m_modeCombo = nullptr;
    SwitchBox* m_showTitleSwitch = nullptr;
    SwitchBox* m_autoStartSwitch = nullptr;
    QComboBox* m_fullScaleCombo = nullptr;
    QComboBox* m_compactScaleCombo = nullptr;
    SwitchBox* m_hideNamesSwitch = nullptr;

    // Площадки
    QFormLayout* m_platformForm = nullptr;
    QButtonGroup* m_platformButtons = nullptr;
    QToolButton* m_platformToolButtons[kPlatformCount] = {};
    SwitchBox* m_enabledSwitch = nullptr;
    QLineEdit* m_channelEdit = nullptr;
    QLabel* m_hintLabel = nullptr;
    QPushButton* m_revealKeysButton = nullptr;
    QLineEdit* m_keyEdit = nullptr;
    QLineEdit* m_secretEdit = nullptr;
    QPushButton* m_testButton = nullptr;
    QLabel* m_testResultLabel = nullptr;

    // Виджет
    QComboBox* m_styleCombo = nullptr;
    QComboBox* m_accentCombo = nullptr;
    QSlider* m_bgSlider = nullptr;
    QLabel* m_bgValueLabel = nullptr;
    QSlider* m_radiusSlider = nullptr;
    QLabel* m_radiusValueLabel = nullptr;
    QSlider* m_scaleSlider = nullptr;
    QLabel* m_scaleValueLabel = nullptr;
    SwitchBox* m_blurSwitch = nullptr;
    SwitchBox* m_tilesSwitch = nullptr;
    SwitchBox* m_totalSwitch = nullptr;
    SwitchBox* m_namesSwitch = nullptr;
    SwitchBox* m_titleSwitch = nullptr;
    SwitchBox* m_animSwitch = nullptr;
    QLineEdit* m_urlEdit = nullptr;
    QPushButton* m_copyUrlButton = nullptr;
};

} // namespace yawametrics
