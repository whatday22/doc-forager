using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace DocForager.Desktop;

internal readonly record struct OverlayTarget(float X, float Y);

internal sealed class SpiderOverlay : Form
{
    private sealed class TrailPoint(float x, float y, float life)
    {
        public float X { get; } = x;
        public float Y { get; } = y;
        public float Life { get; set; } = life;
    }

    private readonly Queue<OverlayTarget> _targets = new();
    private readonly List<OverlayTarget> _visited = new();
    private readonly List<TrailPoint> _trail = new();
    private readonly System.Windows.Forms.Timer _timer;
    private PointF _position;
    private PointF _start;
    private PointF _control;
    private PointF _destination;
    private float _progress;
    private float _segmentLength = 1;
    private float _speed = 520;
    private float _legs;
    private float _glow = 0.28f;
    private float _angle = -MathF.PI / 2;
    private float _wanderTimer;
    private float _scanTimer;
    private bool _traveling;
    private bool _scanning;

    public SpiderOverlay()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        AutoScaleMode = AutoScaleMode.None;
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint, true);
        _timer = new System.Windows.Forms.Timer { Interval = 16 };
        _timer.Tick += (_, _) => Step(0.016f);
    }

    public void InitializeHandle() => _ = Handle;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.ExStyle |= 0x00000020 | 0x00000080 | 0x08000000;
            return parameters;
        }
    }

    public void ShowOverlay()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)ShowOverlay);
            return;
        }

        var screen = NativeMethods.GetVirtualScreen();
        Bounds = screen;
        if (!Visible)
        {
            _position = new PointF(screen.Width / 2f, screen.Height / 2f);
            _trail.Clear();
            Show();
        }
        _timer.Start();
        Invalidate();
    }

    public void SetCrawlSpeed(int targetCount)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)(() => SetCrawlSpeed(targetCount)));
            return;
        }

        _speed = Math.Clamp(8800f / MathF.Sqrt(Math.Max(1, targetCount)), 1040f, 4800f);
    }

    public void CrawlTo(OverlayTarget target)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)(() => CrawlTo(target)));
            return;
        }

        _targets.Enqueue(target);
        _wanderTimer = 0;
        if (!Visible) ShowOverlay();
        Invalidate();
    }

    public void ClearOverlay()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)ClearOverlay);
            return;
        }

        _targets.Clear();
        _visited.Clear();
        _trail.Clear();
        _traveling = false;
        _scanning = false;
        _timer.Stop();
        Hide();
    }

    private void Step(float dt)
    {
        _legs += dt * 16;
        if (_traveling)
        {
            _progress += dt * (_speed / Math.Max(60, _segmentLength)) * 1.9f;
            if (_progress >= 1)
            {
                _position = _destination;
                _traveling = false;
                if (_visited.Count < 500) _visited.Add(new OverlayTarget(_position.X + Left, _position.Y + Top));
                _scanTimer = 0.32f;
            }
            else
            {
                var u = 1 - _progress;
                _position = new PointF(
                    u * u * _start.X + 2 * u * _progress * _control.X + _progress * _progress * _destination.X,
                    u * u * _start.Y + 2 * u * _progress * _control.Y + _progress * _progress * _destination.Y);
            }
            _trail.Add(new TrailPoint(_position.X, _position.Y, 1));
            if (_trail.Count > 110) _trail.RemoveAt(0);
        }
        else if (_targets.Count > 0)
        {
            BeginTravel(_targets.Dequeue());
        }
        else if (_visited.Count > 0)
        {
            _wanderTimer -= dt;
            if (_wanderTimer <= 0)
            {
                _wanderTimer = 1.6f + Random.Shared.NextSingle() * 2.2f;
                var target = _visited[Random.Shared.Next(_visited.Count)];
                if (VectorDistance(_position, new PointF(target.X - Left, target.Y - Top)) > 3)
                    BeginTravel(target);
            }
        }

        for (var i = _trail.Count - 1; i >= 0; i--)
        {
            _trail[i].Life -= dt * 1.5f;
            if (_trail[i].Life <= 0) _trail.RemoveAt(i);
        }
        _scanTimer = Math.Max(0, _scanTimer - dt);
        _scanning = _scanTimer > 0;
        _glow = _traveling ? Math.Min(1, _glow + dt * 3) : Math.Max(0.28f, _glow - dt * 2);
        Invalidate();
    }

    private void BeginTravel(OverlayTarget target)
    {
        _start = _position;
        _destination = new PointF(target.X - Left, target.Y - Top);
        var dx = _destination.X - _start.X;
        var dy = _destination.Y - _start.Y;
        _segmentLength = MathF.Sqrt(dx * dx + dy * dy);
        if (_segmentLength < 1) return;
        var offset = (Random.Shared.NextSingle() < 0.5f ? -1 : 1) * Math.Min(52, _segmentLength * 0.26f);
        _control = new PointF(
            (_start.X + _destination.X) / 2 - dy / _segmentLength * offset,
            (_start.Y + _destination.Y) / 2 + dx / _segmentLength * offset);
        _angle = MathF.Atan2(dy, dx);
        _progress = 0;
        _traveling = true;
    }

    private static float VectorDistance(PointF point, PointF target)
    {
        var dx = point.X - target.X;
        var dy = point.Y - target.Y;
        return MathF.Sqrt(dx * dx + dy * dy);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        DrawSpider(graphics);
    }

    private void DrawSpider(Graphics graphics)
    {
        var time = Environment.TickCount64 / 1000f;
        for (var i = 0; i < _trail.Count; i++)
        {
            var point = _trail[i];
            var alpha = (int)(255 * point.Life * 0.5f * (i / (float)Math.Max(1, _trail.Count)));
            using var brush = new SolidBrush(Color.FromArgb(alpha, 0, 255, 198));
            var radius = 1.6f * point.Life + 0.5f;
            graphics.FillEllipse(brush, point.X - radius, point.Y - radius, radius * 2, radius * 2);
        }

        var state = graphics.Save();
        graphics.TranslateTransform(_position.X, _position.Y);
        graphics.RotateTransform(_angle * 180 / MathF.PI);

        var centerAlpha = (int)(255 * (0.30f * _glow + 0.12f + (_scanning ? 0.10f : 0)));
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(-26, -26, 52, 52);
            using var glow = new PathGradientBrush(path)
            {
                CenterColor = Color.FromArgb(centerAlpha, 0, 255, 198),
                SurroundColors = [Color.FromArgb(0, 0, 255, 198)]
            };
            graphics.FillPath(glow, path);
        }

        using (var legs = new Pen(Color.FromArgb(199, 0, 255, 198), 1))
        {
            for (var i = 0; i < 3; i++)
            {
                var offset = -3 + i * 3.4f;
                var phase = MathF.Sin(_legs + i * 1.9f) * 2.4f;
                graphics.DrawLines(legs,
                [
                    new PointF(offset, 2.2f),
                    new PointF(offset + phase, 7.5f),
                    new PointF(offset + phase + 1.5f, 10.5f)
                ]);
                graphics.DrawLines(legs,
                [
                    new PointF(offset, -2.2f),
                    new PointF(offset - phase, -7.5f),
                    new PointF(offset - phase - 1.5f, -10.5f)
                ]);
            }
        }

        using (var body = new SolidBrush(Color.FromArgb(255, 11, 43, 38)))
        using (var edge = new Pen(Color.FromArgb(255, 0, 255, 198), 1.2f))
        {
            graphics.FillEllipse(body, -8.4f, -5.2f, 16.8f, 10.4f);
            graphics.DrawEllipse(edge, -8.4f, -5.2f, 16.8f, 10.4f);
        }

        using (var eye = new SolidBrush(Color.FromArgb(255, 0, 255, 198)))
        {
            graphics.FillEllipse(eye, 3.1f, -3, 3, 3);
            graphics.FillEllipse(eye, 3.1f, -0.0f, 3, 3);
        }

        var antennaA = MathF.Sin(time * 7) * 1.6f;
        var antennaB = MathF.Sin(time * 7 + 1) * 1.6f;
        using (var antenna = new Pen(Color.FromArgb(217, 0, 255, 198), 1))
        using (var tip = new SolidBrush(Color.FromArgb(255, 255, 46, 91)))
        {
            graphics.DrawLine(antenna, 6, -1, 12, -5 + antennaA);
            graphics.DrawLine(antenna, 6, 1, 12, 5 + antennaB);
            graphics.FillEllipse(tip, 10.6f, -6.4f + antennaA, 2.8f, 2.8f);
            graphics.FillEllipse(tip, 10.6f, 3.6f + antennaB, 2.8f, 2.8f);
        }

        if (_scanning)
        {
            var sweep = (time * 3) % 1;
            var radius = 16 + MathF.Sin(sweep * MathF.PI) * 10;
            using var scan = new Pen(Color.FromArgb(230, 255, 214, 10), 1.4f);
            graphics.DrawArc(scan, -radius, -radius, radius * 2, radius * 2, -52, 104);
        }

        graphics.Restore(state);
    }
}
