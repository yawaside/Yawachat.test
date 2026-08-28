// YawaMetrics — reusable UI widgets implementation.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "widgets.hpp"

#include <QEnterEvent>
#include <QEvent>
#include <QFontMetrics>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QLinearGradient>
#include <QMouseEvent>
#include <QPaintEvent>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QResizeEvent>
#include <QTransform>

#include <cmath>
#include <QtGlobal>

namespace yawametrics {

namespace {

// Палитра изделия (§6.1) — используемые в виджетах токены
const QColor kColorAccent = QColor(QStringLiteral("#8b5cf6"));
const QColor kColorAccent2 = QColor(QStringLiteral("#d946ef"));
const QColor kColorLive = QColor(QStringLiteral("#22c55e"));
const QColor kColorMuted = QColor(QStringLiteral("#8b91a8"));

qreal sinePhase(qreal phase)
{
    return 0.5 + 0.5 * std::sin(phase);
}

} // namespace

// ---------------------------------------------------------------------------
// Парсер SVG path-data (§5.3)
// ---------------------------------------------------------------------------

namespace {

class PathParser {
public:
    explicit PathParser(const QString& text)
        : m_text(text)
    {
    }

    QPainterPath parse()
    {
        skipBlanks();
        while (m_pos < m_text.size()) {
            const QChar ch = m_text.at(m_pos);
            if (ch.isLetter()) {
                const char command = ch.toLatin1();
                ++m_pos;
                skipBlanks();
                execute(command, false);
                skipBlanks();
                continue;
            }
            // Число или знак без команды — неявный повтор последней команды.
            if (ch.isDigit() || ch == QLatin1Char('+') || ch == QLatin1Char('-')
                || ch == QLatin1Char('.')) {
                if (m_lastCommand.isNull())
                    break;
                execute(m_lastCommand.toLatin1(), true);
                skipBlanks();
                continue;
            }
            ++m_pos; // разделитель или мусор — пропустить
            skipBlanks();
        }
        return m_path;
    }

private:
    void skipBlanks()
    {
        while (m_pos < m_text.size()
               && (m_text.at(m_pos).isSpace() || m_text.at(m_pos) == QLatin1Char(','))) {
            ++m_pos;
        }
    }

    bool parseNumber(double* value)
    {
        skipBlanks();
        const int start = m_pos;
        if (m_pos < m_text.size()
            && (m_text.at(m_pos) == QLatin1Char('+') || m_text.at(m_pos) == QLatin1Char('-'))) {
            ++m_pos;
        }
        while (m_pos < m_text.size() && m_text.at(m_pos).isDigit()) {
            ++m_pos;
        }
        if (m_pos < m_text.size() && m_text.at(m_pos) == QLatin1Char('.')) {
            ++m_pos;
            while (m_pos < m_text.size() && m_text.at(m_pos).isDigit()) {
                ++m_pos;
            }
        }
        if (m_pos < m_text.size()
            && (m_text.at(m_pos) == QLatin1Char('e') || m_text.at(m_pos) == QLatin1Char('E'))) {
            const int save = m_pos;
            ++m_pos;
            if (m_pos < m_text.size()
                && (m_text.at(m_pos) == QLatin1Char('+') || m_text.at(m_pos) == QLatin1Char('-'))) {
                ++m_pos;
            }
            if (m_pos < m_text.size() && m_text.at(m_pos).isDigit()) {
                while (m_pos < m_text.size() && m_text.at(m_pos).isDigit()) {
                    ++m_pos;
                }
            } else {
                m_pos = save; // «e» без цифр — не экспонента
            }
        }
        if (m_pos == start)
            return false;
        bool ok = false;
        *value = m_text.mid(start, m_pos - start).toDouble(&ok);
        return ok;
    }

    bool parsePair(QPointF* point)
    {
        double x = 0.0;
        double y = 0.0;
        if (!parseNumber(&x) || !parseNumber(&y))
            return false;
        *point = QPointF(x, y);
        return true;
    }

    void execute(char command, bool implicitRepeat)
    {
        Q_UNUSED(implicitRepeat)

        QPointF point;
        QPointF control1;
        QPointF control2;

        switch (command) {
        case 'M':
        case 'm': {
            if (!parsePair(&point))
                return;
            if (command == 'm')
                point += m_current;
            m_path.moveTo(point);
            m_current = point;
            m_subpathStart = point;
            m_lastCommand = command == 'm' ? QLatin1Char('l') : QLatin1Char('L'); // неявное продолжение
            break;
        }
        case 'L':
        case 'l': {
            if (!parsePair(&point))
                return;
            if (command == 'l')
                point += m_current;
            m_path.lineTo(point);
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'H':
        case 'h': {
            double x = 0.0;
            if (!parseNumber(&x))
                return;
            m_path.lineTo(command == 'h' ? m_current.x() + x : x, m_current.y());
            m_current = QPointF(command == 'h' ? m_current.x() + x : x, m_current.y());
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'V':
        case 'v': {
            double y = 0.0;
            if (!parseNumber(&y))
                return;
            m_path.lineTo(m_current.x(), command == 'v' ? m_current.y() + y : y);
            m_current = QPointF(m_current.x(), command == 'v' ? m_current.y() + y : y);
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'C':
        case 'c': {
            if (!parsePair(&control1) || !parsePair(&control2) || !parsePair(&point))
                return;
            if (command == 'c') {
                control1 += m_current;
                control2 += m_current;
                point += m_current;
            }
            m_path.cubicTo(control1, control2, point);
            m_lastCubicControl = control2;
            m_hasCubic = true;
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'S':
        case 's': {
            if (!parsePair(&control2) || !parsePair(&point))
                return;
            control1 = m_hasCubic
                ? QPointF(2 * m_current.x() - m_lastCubicControl.x(),
                          2 * m_current.y() - m_lastCubicControl.y())
                : m_current;
            if (command == 's') {
                control2 += m_current;
                point += m_current;
            }
            m_path.cubicTo(control1, control2, point);
            m_lastCubicControl = control2;
            m_hasCubic = true;
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'Q':
        case 'q': {
            if (!parsePair(&control1) || !parsePair(&point))
                return;
            if (command == 'q') {
                control1 += m_current;
                point += m_current;
            }
            m_path.quadTo(control1, point);
            m_lastQuadControl = control1;
            m_hasQuad = true;
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'T':
        case 't': {
            if (!parsePair(&point))
                return;
            control1 = m_hasQuad
                ? QPointF(2 * m_current.x() - m_lastQuadControl.x(),
                          2 * m_current.y() - m_lastQuadControl.y())
                : m_current;
            if (command == 't')
                point += m_current;
            m_path.quadTo(control1, point);
            m_lastQuadControl = control1;
            m_hasQuad = true;
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'A':
        case 'a': {
            // Дуга упрощается до хорды: rx ry rot large-arc sweep x y (§5.3)
            double rx = 0.0;
            double ry = 0.0;
            double rotation = 0.0;
            double largeArc = 0.0;
            double sweep = 0.0;
            if (!parseNumber(&rx) || !parseNumber(&ry) || !parseNumber(&rotation)
                || !parseNumber(&largeArc) || !parseNumber(&sweep) || !parsePair(&point)) {
                return;
            }
            if (command == 'a')
                point += m_current;
            m_path.lineTo(point);
            m_current = point;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        case 'Z':
        case 'z': {
            m_path.closeSubpath();
            m_current = m_subpathStart;
            m_lastCommand = QLatin1Char(command);
            break;
        }
        default:
            break; // неизвестная команда — пропустить
        }
    }

    const QString& m_text;
    int m_pos = 0;
    QPainterPath m_path;
    QPointF m_current;
    QPointF m_subpathStart;
    QPointF m_lastCubicControl;
    QPointF m_lastQuadControl;
    bool m_hasCubic = false;
    bool m_hasQuad = false;
    QChar m_lastCommand;
};

} // namespace

QPainterPath pathFromSvgPathData(const QString& data)
{
    PathParser parser(data);
    QPainterPath path = parser.parse();
    path.setFillRule(Qt::WindingFill);
    return path;
}

QPixmap renderBrandIcon(PlatformId id, int size, const QColor& tint)
{
    if (size <= 0)
        return QPixmap();

    static QHash<QString, QPixmap> cache;
    const QColor color = tint.isValid() ? tint : platformColor(id);
    const QString key = QStringLiteral("%1:%2:%3").arg(platformIdName(id)).arg(size).arg(color.name());
    const auto it = cache.constFind(key);
    if (it != cache.constEnd())
        return it.value();

    QPixmap pixmap(size, size);
    pixmap.fill(Qt::transparent);

    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing, true);

    QPainterPath path = pathFromSvgPathData(QString::fromLatin1(platformIconPath(id)));
    const QRectF source(0, 0, 24, 24);
    const qreal scale = qreal(size) / 24.0;
    QTransform transform;
    transform.scale(scale, scale);
    path = transform.map(path);

    painter.setPen(Qt::NoPen);
    painter.setBrush(color);
    painter.drawPath(path);
    painter.end();

    cache.insert(key, pixmap);
    return pixmap;
}

QPixmap renderLogoPixmap(int size)
{
    if (size <= 0)
        return QPixmap();

    QPixmap pixmap(size, size);
    pixmap.fill(Qt::transparent);

    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QRectF rect(0, 0, size, size);
    QLinearGradient gradient(QPointF(0, 0), QPointF(size, size));
    gradient.setColorAt(0.0, kColorAccent);
    gradient.setColorAt(1.0, kColorAccent2);

    QPainterPath rounded;
    rounded.addRoundedRect(rect, size * 0.28, size * 0.28);

    painter.setPen(Qt::NoPen);
    painter.setBrush(gradient);
    painter.drawPath(rounded);

    QFont font = ymFont(qMax(8, qRound(size * 0.58)), 900);
    painter.setFont(font);
    painter.setPen(QColor(Qt::white));
    painter.drawText(rect, Qt::AlignCenter, QStringLiteral("Y"));
    painter.end();
    return pixmap;
}

QString middleElidedText(const QString& text, const QFontMetrics& metrics, int width)
{
    if (text.isEmpty())
        return text;
    if (metrics.horizontalAdvance(text) <= width)
        return text;

    const QString ellipsis = QStringLiteral("…");
    const int ellipsisWidth = metrics.horizontalAdvance(ellipsis);
    if (width <= ellipsisWidth)
        return ellipsis;

    int headLength = text.size() / 2;
    int tailLength = text.size() - headLength;
    while (headLength > 0 && tailLength > 0) {
        const QString candidate = text.left(headLength) + ellipsis + text.right(tailLength);
        if (metrics.horizontalAdvance(candidate) <= width)
            return candidate;
        if (headLength >= tailLength)
            --headLength;
        else
            --tailLength;
    }
    return text.left(qMax(1, headLength)) + ellipsis;
}

QFont ymFont(int px, int weight)
{
    QFont font;
    font.setFamilies({QStringLiteral("Inter"), QStringLiteral("Segoe UI"),
                      QStringLiteral("SF Pro Text"), QStringLiteral("Roboto"),
                      QStringLiteral("Arial"), QStringLiteral("system-ui")});
    font.setPixelSize(qMax(1, px));
    font.setWeight(static_cast<QFont::Weight>(weight));
    return font;
}

QString formatViewers(long long viewers)
{
    return QLocale::system().toString(static_cast<qulonglong>(qMax<long long>(0, viewers)));
}

// ---------------------------------------------------------------------------
// FitLabel
// ---------------------------------------------------------------------------

FitLabel::FitLabel(QWidget* parent)
    : QLabel(parent)
{
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    setMinimumSize(QSize(4, 4));
    setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
}

void FitLabel::setBaseFont(int px, int weight)
{
    m_basePx = px;
    m_baseWeight = weight;
    refit();
}

void FitLabel::setFittedText(const QString& text)
{
    if (m_text == text)
        return;
    m_text = text;
    setText(text);
    refit();
}

void FitLabel::resizeEvent(QResizeEvent* event)
{
    QLabel::resizeEvent(event);
    refit();
}

void FitLabel::refit()
{
    // ФТ-4.5: кегль уменьшается до 70 % базового (но не ниже 8 px),
    // число никогда не обрезается многоточием.
    const int minPx = qMax(8, qRound(m_basePx * 0.7));
    if (m_text.isEmpty() || width() <= 0) {
        setFont(ymFont(m_basePx, m_baseWeight));
        return;
    }

    int fitted = m_basePx;
    if (QFontMetrics(ymFont(fitted, m_baseWeight)).horizontalAdvance(m_text) > width()) {
        int lo = minPx;
        int hi = m_basePx;
        while (lo < hi) {
            const int mid = lo + (hi - lo + 1) / 2;
            if (QFontMetrics(ymFont(mid, m_baseWeight)).horizontalAdvance(m_text) <= width()) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        fitted = lo;
    }
    setFont(ymFont(fitted, m_baseWeight));
}

// ---------------------------------------------------------------------------
// NeonBadge
// ---------------------------------------------------------------------------

NeonBadge::NeonBadge(QWidget* parent)
    : QWidget(parent)
{
    setAttribute(Qt::WA_TranslucentBackground);
    m_timer.setInterval(40); // §6.3: фаза ~40 мс/кадр
    connect(&m_timer, &QTimer::timeout, this, &NeonBadge::advancePhase);
}

void NeonBadge::setBadge(const QString& text, const QColor& color, bool pulsing)
{
    m_text = text;
    m_color = color;
    m_pulsing = pulsing;
    m_phase = 0.0;
    if (m_pulsing) {
        m_timer.start();
    } else {
        m_timer.stop();
    }
    updateGeometry();
    update();
}

QSize NeonBadge::sizeHint() const
{
    QFont font = ymFont(10, 800);
    font.setLetterSpacing(QFont::AbsoluteSpacing, 1.0);
    const int textWidth = QFontMetrics(font).horizontalAdvance(m_text);
    return QSize(textWidth + 18, 18);
}

void NeonBadge::advancePhase()
{
    m_phase += 0.09;
    update();
}

void NeonBadge::paintEvent(QPaintEvent* event)
{
    Q_UNUSED(event)

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    QFont font = ymFont(10, 800);
    font.setLetterSpacing(QFont::AbsoluteSpacing, 1.0);
    painter.setFont(font);

    const qreal pulse = m_pulsing ? sinePhase(m_phase) : 0.0;
    const QRectF rect = this->rect().adjusted(0, 1, 0, -1);
    const qreal radius = rect.height() / 2.0;

    // Подложка
    QColor fill = m_color;
    fill.setAlphaF(0.14 + 0.12 * pulse);
    painter.setPen(Qt::NoPen);
    painter.setBrush(fill);
    painter.drawRoundedRect(rect, radius, radius);

    // Свечение при live
    if (m_pulsing) {
        QColor glow = m_color;
        glow.setAlphaF(0.55 + 0.45 * pulse);
        QPen pen(glow, 1.4);
        painter.setPen(pen);
        painter.setBrush(Qt::NoBrush);
        painter.drawRoundedRect(rect.adjusted(0.5, 0.5, -0.5, -0.5), radius, radius);
    }

    QColor text = m_color.lighter(m_pulsing ? 150 : 120);
    painter.setPen(text);
    painter.drawText(rect, Qt::AlignCenter, m_text);
}

// ---------------------------------------------------------------------------
// NeonDot
// ---------------------------------------------------------------------------

NeonDot::NeonDot(QWidget* parent)
    : QWidget(parent)
{
    setFixedSize(12, 12); // §6.3
    setAttribute(Qt::WA_TranslucentBackground);
    m_timer.setInterval(40);
    connect(&m_timer, &QTimer::timeout, this, &NeonDot::advancePhase);
}

void NeonDot::setState(bool live, const QColor& color)
{
    m_live = live;
    m_color = color;
    if (m_live) {
        m_timer.start();
    } else {
        m_timer.stop();
        m_phase = 0.0;
    }
    update();
}

QSize NeonDot::sizeHint() const
{
    return QSize(12, 12);
}

void NeonDot::advancePhase()
{
    m_phase += 0.09;
    update();
}

void NeonDot::paintEvent(QPaintEvent* event)
{
    Q_UNUSED(event)

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QPointF center = rect().center();
    const qreal pulse = m_live ? sinePhase(m_phase) : 0.0;

    if (m_live) {
        QColor halo = m_color;
        halo.setAlphaF(0.18 + 0.30 * pulse);
        painter.setPen(Qt::NoPen);
        painter.setBrush(halo);
        painter.drawEllipse(center, 5.5 + 0.5 * pulse, 5.5 + 0.5 * pulse);
    }

    painter.setPen(Qt::NoPen);
    painter.setBrush(m_color);
    painter.drawEllipse(center, 3.4, 3.4);
}

// ---------------------------------------------------------------------------
// PulseDot
// ---------------------------------------------------------------------------

PulseDot::PulseDot(QWidget* parent)
    : QWidget(parent)
{
    setFixedSize(14, 14);
    setAttribute(Qt::WA_TranslucentBackground);
    setCursor(Qt::PointingHandCursor);
    setToolTip(ymtr(QStringLiteral("Header.PollNow")));
    m_timer.setInterval(40);
    connect(&m_timer, &QTimer::timeout, this, &PulseDot::advancePhase);
}

void PulseDot::setActive(bool active)
{
    m_active = active;
    if (m_active) {
        m_phase = 0.0;
        m_timer.start();
    } else {
        m_timer.stop();
    }
    update();
}

QSize PulseDot::sizeHint() const
{
    return QSize(14, 14);
}

void PulseDot::advancePhase()
{
    // период ~1400 мс при кадре 40 мс (§6.3)
    m_phase += 0.09;
    if (m_phase > 2 * M_PI)
        m_phase -= 2 * M_PI;
    update();
}

void PulseDot::paintEvent(QPaintEvent* event)
{
    Q_UNUSED(event)

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QPointF center = rect().center();
    if (m_active) {
        const qreal radius = 3.0 + 1.2 * std::sin(m_phase); // 3.0 ± 1.2
        QColor halo = kColorAccent;
        halo.setAlphaF(0.20 + 0.25 * sinePhase(m_phase));
        painter.setPen(Qt::NoPen);
        painter.setBrush(halo);
        painter.drawEllipse(center, radius + 2.6, radius + 2.6);
        painter.setBrush(kColorAccent2);
        painter.drawEllipse(center, radius, radius);
    } else {
        QColor idle = kColorMuted;
        idle.setAlphaF(0.55);
        painter.setPen(Qt::NoPen);
        painter.setBrush(idle);
        painter.drawEllipse(center, 2.6, 2.6);
    }
}

void PulseDot::mousePressEvent(QMouseEvent* event)
{
    if (event->button() == Qt::LeftButton) {
        emit clicked();
        return;
    }
    QWidget::mousePressEvent(event);
}

// ---------------------------------------------------------------------------
// PollProgressBar
// ---------------------------------------------------------------------------

PollProgressBar::PollProgressBar(QWidget* parent)
    : QWidget(parent)
{
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    setFixedHeight(4); // §6.3
    setAttribute(Qt::WA_TranslucentBackground);
}

void PollProgressBar::setFraction(qreal fraction)
{
    m_fraction = qBound(0.0, fraction, 1.0);
    update();
}

QSize PollProgressBar::sizeHint() const
{
    return QSize(40, 4);
}

void PollProgressBar::paintEvent(QPaintEvent* event)
{
    Q_UNUSED(event)

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QRectF rect = this->rect();
    const qreal radius = 2.0; // скругление 2 px

    QColor track(255, 255, 255, 20);
    painter.setPen(Qt::NoPen);
    painter.setBrush(track);
    painter.drawRoundedRect(rect, radius, radius);

    if (m_fraction <= 0.0)
        return;

    QLinearGradient gradient(rect.topLeft(), rect.topRight());
    gradient.setColorAt(0.0, kColorAccent);
    gradient.setColorAt(1.0, kColorAccent2);
    painter.setBrush(gradient);
    painter.drawRoundedRect(QRectF(rect.left(), rect.top(), rect.width() * m_fraction, rect.height()),
                            radius, radius);
}

// ---------------------------------------------------------------------------
// SwitchBox
// ---------------------------------------------------------------------------

SwitchBox::SwitchBox(QWidget* parent)
    : QWidget(parent)
{
    setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    setFixedSize(46, 24); // трек 46x24 (§6.3)
    setCursor(Qt::PointingHandCursor);
    setFocusPolicy(Qt::StrongFocus);
    setAttribute(Qt::WA_TranslucentBackground);
}

bool SwitchBox::isChecked() const
{
    return m_checked;
}

void SwitchBox::setChecked(bool checked)
{
    if (m_checked == checked)
        return;
    m_checked = checked;
    update();
    emit toggled(m_checked);
}

QSize SwitchBox::sizeHint() const
{
    return QSize(46, 24);
}

void SwitchBox::paintEvent(QPaintEvent* event)
{
    Q_UNUSED(event)

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QRectF rect = this->rect();
    const qreal radius = 12.0; // скругление 12 px (§6.3)

    QColor track = m_checked ? kColorLive : QColor(QStringLiteral("#2b3240"));
    if (m_hovered)
        track = track.lighter(m_checked ? 110 : 130);

    if (m_hovered) {
        QColor halo = m_checked ? kColorLive : kColorAccent;
        halo.setAlphaF(0.25);
        painter.setPen(QPen(halo, 1.4));
    } else {
        painter.setPen(Qt::NoPen);
    }
    painter.setBrush(track);
    painter.drawRoundedRect(rect.adjusted(1, 1, -1, -1), radius, radius);

    // Ручка 18 px
    const qreal knobDiameter = 18.0;
    const qreal x = m_checked ? rect.right() - knobDiameter - 3.0 : 3.0;
    const QRectF knobRect(x, (rect.height() - knobDiameter) / 2.0, knobDiameter, knobDiameter);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(Qt::white));
    painter.drawEllipse(knobRect);
}

void SwitchBox::mousePressEvent(QMouseEvent* event)
{
    if (event->button() == Qt::LeftButton) {
        m_checked = !m_checked;
        update();
        emit toggled(m_checked);
    } else {
        QWidget::mousePressEvent(event);
    }
}

void SwitchBox::enterEvent(QEnterEvent* event)
{
    QWidget::enterEvent(event);
    m_hovered = true;
    update();
}

void SwitchBox::leaveEvent(QEvent* event)
{
    QWidget::leaveEvent(event);
    m_hovered = false;
    update();
}

void SwitchBox::keyPressEvent(QKeyEvent* event)
{
    if (event->key() == Qt::Key_Space || event->key() == Qt::Key_Return
        || event->key() == Qt::Key_Enter) {
        m_checked = !m_checked;
        update();
        emit toggled(m_checked);
        return;
    }
    QWidget::keyPressEvent(event);
}

// ---------------------------------------------------------------------------
// ElidedLabel
// ---------------------------------------------------------------------------

ElidedLabel::ElidedLabel(QWidget* parent)
    : QLabel(parent)
{
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
}

void ElidedLabel::setFullText(const QString& text)
{
    if (m_fullText == text) {
        return;
    }
    m_fullText = text;
    refresh();
}

QString ElidedLabel::fullText() const
{
    return m_fullText;
}

void ElidedLabel::resizeEvent(QResizeEvent* event)
{
    QLabel::resizeEvent(event);
    refresh();
}

void ElidedLabel::refresh()
{
    setText(middleElidedText(m_fullText, fontMetrics(), qMax(0, width() - 2)));
}

// ---------------------------------------------------------------------------
// PollFooter
// ---------------------------------------------------------------------------

PollFooter::PollFooter(QWidget* parent)
    : QWidget(parent)
{
    m_bar = new PollProgressBar(this);
    m_label = new QLabel(this);
    m_versionLabel = new QLabel(QStringLiteral("v") + QStringLiteral(YAWAMETRICS_VERSION), this);

    m_label->setFont(ymFont(10, 400));
    m_label->setStyleSheet(QStringLiteral("color:#8b91a8;"));
    m_versionLabel->setFont(ymFont(10, 400));
    m_versionLabel->setStyleSheet(QStringLiteral("color:#565b6e;"));

    auto* layout = new QHBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(8);
    layout->addWidget(m_bar, 1);
    layout->addWidget(m_label, 0, Qt::AlignVCenter);
    layout->addWidget(m_versionLabel, 0, Qt::AlignVCenter);

    setCountdown(0, 15);
}

void PollFooter::setCountdown(int secondsLeft, int intervalSec)
{
    m_secondsLeft = secondsLeft;
    m_intervalSec = qMax(1, intervalSec);
    refresh();
}

void PollFooter::setPollingActive(bool active)
{
    m_active = active;
    refresh();
}

void PollFooter::refresh()
{
    if (!m_active) {
        m_bar->setFraction(0.0);
        m_label->setText(ymtr(QStringLiteral("Footer.Idle")));
        return;
    }
    m_bar->setFraction(m_intervalSec > 0 ? qreal(m_secondsLeft) / qreal(m_intervalSec) : 0.0);
    if (m_secondsLeft > 0) {
        m_label->setText(ymtr(QStringLiteral("Footer.Countdown"))
                             .arg(m_secondsLeft)
                             .arg(m_intervalSec));
    } else {
        m_label->setText(ymtr(QStringLiteral("Footer.Countdown.Busy")));
    }
}

} // namespace yawametrics
