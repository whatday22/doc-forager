using System.Drawing;
using System.Drawing.Imaging;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace DocForager.Desktop;

internal sealed record ScreenBounds(int X, int Y, int Width, int Height);
internal sealed record OcrBlock(string Text, float X, float Y, float Width, float Height);
internal sealed record OcrScreenResult(ScreenBounds VirtualScreen, IReadOnlyList<OcrBlock> Blocks);

internal static class DesktopOcr
{
    private const int TileOverlap = 64;

    public static async Task<OcrScreenResult> ReadVirtualScreenAsync(CancellationToken cancellationToken)
    {
        var bounds = NativeMethods.GetVirtualScreen();
        if (bounds.Width <= 0 || bounds.Height <= 0)
            throw new InvalidOperationException("Windows 没有报告有效的虚拟桌面区域。");

        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is null)
            throw new InvalidOperationException("找不到可用的 Windows OCR 语言包。请在 Windows 设置中安装屏幕文字对应的语言。");

        var maxDimension = (int)OcrEngine.MaxImageDimension;
        if (maxDimension <= 0)
            throw new InvalidOperationException("Windows OCR 返回了无效的图像尺寸上限。");
        var stride = Math.Max(1, maxDimension - TileOverlap);
        var blocks = new List<OcrBlock>();

        foreach (var monitor in Screen.AllScreens)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var monitorBounds = monitor.Bounds;
            if (monitorBounds.Width <= 0 || monitorBounds.Height <= 0) continue;
            using var screenshot = new Bitmap(
                monitorBounds.Width,
                monitorBounds.Height,
                PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(screenshot))
            {
                graphics.CopyFromScreen(
                    monitorBounds.Location,
                    Point.Empty,
                    monitorBounds.Size,
                    CopyPixelOperation.SourceCopy);
            }

            for (var top = 0; top < screenshot.Height; top += stride)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var tileHeight = Math.Min(maxDimension, screenshot.Height - top);
                for (var left = 0; left < screenshot.Width; left += stride)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var tileWidth = Math.Min(maxDimension, screenshot.Width - left);
                    using var tile = screenshot.Clone(
                        new Rectangle(left, top, tileWidth, tileHeight),
                        PixelFormat.Format32bppArgb);
                    var recognized = await RecognizeTileAsync(engine, tile, cancellationToken);
                    foreach (var line in recognized)
                    {
                        var rect = GetLineBounds(line);
                        var block = new OcrBlock(
                            line.Text.Trim(),
                            monitorBounds.Left + left + (float)rect.X,
                            monitorBounds.Top + top + (float)rect.Y,
                            (float)rect.Width,
                            (float)rect.Height);
                        if (block.Text.Length > 0 && block.Width > 0 && block.Height > 0 &&
                            !IsOverlapDuplicate(blocks, block))
                            blocks.Add(block);
                    }
                }
            }
        }

        blocks.Sort((a, b) => a.Y != b.Y ? a.Y.CompareTo(b.Y) : a.X.CompareTo(b.X));

        return new OcrScreenResult(
            new ScreenBounds(bounds.Left, bounds.Top, bounds.Width, bounds.Height),
            blocks);
    }

    private static async Task<IReadOnlyList<OcrLine>> RecognizeTileAsync(
        OcrEngine engine,
        Bitmap tile,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var png = new MemoryStream();
        tile.Save(png, ImageFormat.Png);

        using var stream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(stream.GetOutputStreamAt(0)))
        {
            writer.WriteBytes(png.ToArray());
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }
        stream.Seek(0);

        var decoder = await BitmapDecoder.CreateAsync(stream);
        using var bitmap = await decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied);
        cancellationToken.ThrowIfCancellationRequested();
        var result = await engine.RecognizeAsync(bitmap);
        cancellationToken.ThrowIfCancellationRequested();
        return result.Lines.ToArray();
    }

    private static bool IsOverlapDuplicate(IReadOnlyList<OcrBlock> blocks, OcrBlock candidate)
    {
        var a = new RectangleF(candidate.X, candidate.Y, candidate.Width, candidate.Height);
        var area = Math.Max(1, a.Width * a.Height);
        foreach (var existing in blocks)
        {
            if (!string.Equals(existing.Text, candidate.Text, StringComparison.Ordinal)) continue;
            var b = new RectangleF(existing.X, existing.Y, existing.Width, existing.Height);
            var overlap = RectangleF.Intersect(a, b);
            if (overlap.Width > 0 && overlap.Height > 0 &&
                overlap.Width * overlap.Height / area >= 0.45f)
                return true;
        }
        return false;
    }

    private static Windows.Foundation.Rect GetLineBounds(OcrLine line)
    {
        if (line.Words.Count == 0) return new Windows.Foundation.Rect();
        var bounds = line.Words[0].BoundingRect;
        for (var i = 1; i < line.Words.Count; i++)
        {
            var word = line.Words[i].BoundingRect;
            var left = Math.Min(bounds.X, word.X);
            var top = Math.Min(bounds.Y, word.Y);
            bounds = new Windows.Foundation.Rect(
                left,
                top,
                Math.Max(bounds.X + bounds.Width, word.X + word.Width) - left,
                Math.Max(bounds.Y + bounds.Height, word.Y + word.Height) - top);
        }
        return bounds;
    }
}
