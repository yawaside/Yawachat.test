// YawaMetrics — OBS Studio module entry point.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Регистрация док-панели через obs_frontend_add_dock(QDockWidget*) (§4.1).
// Функции obs_frontend_add_dock_by_id/remove_dock доступны только с OBS 30+
// и не используются при линковке с 29.1.3 (ОР-10).

#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QDockWidget>
#include <QPointer>

#include "ui/dock_panel.hpp"

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("yawametrics", "ru-RU") // ФТ-8.1

using namespace yawametrics;

namespace {

QPointer<QDockWidget> g_dock;
QPointer<DockPanel> g_panel;

} // namespace

MODULE_EXPORTED extern "C" bool obs_module_load(void)
{
    // Переводы: data/locale/<locale>.ini, ru-RU — основной (ФТ-8.2).
    loadStrings();

    qRegisterMetaType<PlatformId>("yawametrics::PlatformId");

    // НФТ-6: время жизни виджета, переданного в док, контролирует OBS.
    g_panel = new DockPanel();

    g_dock = new QDockWidget(ymtr(QStringLiteral("Dock.Title")));
    g_dock->setObjectName(QStringLiteral("yawametricsDock"));
    g_dock->setWidget(g_panel);
    obs_frontend_add_dock(g_dock); // ФТ-1.1, ФТ-1.2: пункт «Вид → Док-панели → YawaMetrics»

    blog(LOG_INFO, "[YawaMetrics] plugin loaded, version %s", YAWAMETRICS_VERSION);
    return true;
}

MODULE_EXPORTED extern "C" void obs_module_unload(void)
{
    // НФТ-4: остановить таймеры/опрос; сам виджет удаляет OBS.
    if (g_panel)
        g_panel->shutdown();
    if (g_dock) {
        g_dock->hide();
        g_dock->deleteLater();
        g_dock = nullptr;
    }
    g_panel = nullptr;
    blog(LOG_INFO, "[YawaMetrics] plugin unloaded");
}
