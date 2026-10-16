using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace DocForager.Desktop;

internal readonly record struct OverlayHit(float X, float Y, float Width, float Height, float Score);

internal sealed class SpiderOverlay : Form
{
    private readonly List<OverlayHit> _hits = new();
    private readonly System.Windows.Forms.Timer _timer;
    private float _bugX;
    private float _bugY;
    private float _targetX;
    private float _targetY;

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
        _timer.Tick += (_, _) =>
        {
            _bugX += (_targetX - _bugX) * 0.095f;
            _bugY += (_targetY - _bugY) * 0.095f;
            Invalidate();
        };
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
        _hits.Clear();
        _bugX = _targetX = screen.Width / 2f;
        _bugY = _targetY = screen.Height / 2f;
        if (!Visible) Show();
        _timer.Start();
        Invalidate();
    }

    public void AddHit(OverlayHit hit)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)(() => AddHit(hit)));
            return;
        }

        _hits.Add(hit);
        if (_hits.Count > 80) _hits.RemoveAt(0);
        _targetX = hit.X - Left + hit.Width / 2f;
        _targetY = hit.Y - Top + hit.Height / 2f;
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

        _hits.Clear();
        _timer.Stop();
        Hide();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        foreach (var hit in _hits)
        {
            var rect = new RectangleF(hit.X - Left, hit.Y - Top, hit.Width, hit.Height);
            if (!ClientRectangle.IntersectsWith(Rectangle.Ceiling(rect))) continue;
            var color = ScoreColor(hit.Score);
            using var outline = new Pen(Color.FromArgb(175, color), 1.5f);
            using var wash = new SolidBrush(Color.FromArgb(26, color));
            graphics.FillRectangle(wash, rect);
            graphics.DrawRectangle(outline, rect.X, rect.Y, rect.Width, rect.Height);
        }

        DrawSpider(graphics);
    }

    private void DrawSpider(Graphics graphics)
    {
        var pulse = 0.72f + 0.28f * MathF.Sin(Environment.TickCount64 / 145f);
        var center = new PointF(_bugX, _bugY);
        var glowColor = Color.FromArgb((int)(35 * pulse), 0, 255, 198);
        using (var glow = new SolidBrush(glowColor))
            graphics.FillEllipse(glow, center.X - 22, center.Y - 22, 44, 44);

        using var legs = new Pen(Color.FromArgb(225, 0, 255, 198), 1.4f);
        for (var i = 0; i < 3; i++)
        {
            var y = -5f + i * 5f;
            var wiggle = MathF.Sin(Environment.TickCount64 / 70f + i) * 2.5f;
            graphics.DrawLine(legs, center.X - 5, center.Y + y, center.X - 12 + wiggle, center.Y + y - 8);
            graphics.DrawLine(legs, center.X - 12 + wiggle, center.Y + y - 8, center.X - 16, center.Y + y - 11);
            graphics.DrawLine(legs, center.X + 5, center.Y + y, center.X + 12 - wiggle, center.Y + y + 8);
            graphics.DrawLine(legs, center.X + 12 - wiggle, center.Y + y + 8, center.X + 16, center.Y + y + 11);
        }

        using var body = new SolidBrush(Color.FromArgb(245, 3, 36, 32));
        using var edge = new Pen(Color.FromArgb(245, 0, 255, 198), 1.5f);
        graphics.FillEllipse(body, center.X - 8, center.Y - 5, 16, 10);
        graphics.DrawEllipse(edge, center.X - 8, center.Y - 5, 16, 10);
        using var eye = new SolidBrush(Color.FromArgb(250, 0, 255, 198));
        graphics.FillEllipse(eye, center.X + 2, center.Y - 2.7f, 2.5f, 2.5f);
        graphics.FillEllipse(eye, center.X + 2, center.Y + 0.5f, 2.5f, 2.5f);
    }

    private static Color ScoreColor(float score) =>
        score >= 0.68f ? Color.FromArgb(61, 255, 136)
        : score >= 0.48f ? Color.FromArgb(255, 214, 10)
        : score >= 0.26f ? Color.FromArgb(255, 157, 46)
        : Color.FromArgb(255, 46, 91);
}
