using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace DocForager.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ForagerApplicationContext());
    }
}

internal sealed class ForagerApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly SpiderOverlay _overlay = new();
    private readonly DesktopBridge _bridge;

    public ForagerApplicationContext()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("退出 Doc Forager 桌面桥接", null, (_, _) => ExitThread());
        _tray = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "Doc Forager · 等待网页控制面板",
            ContextMenuStrip = menu,
            Visible = true
        };
        _overlay.InitializeHandle();
        _bridge = new DesktopBridge(_overlay, _tray);
        try
        {
            _bridge.Start();
        }
        catch (HttpListenerException ex)
        {
            _tray.ShowBalloonTip(5000, "Doc Forager 桌面桥接启动失败", ex.Message, ToolTipIcon.Error);
        }
    }

    protected override void ExitThreadCore()
    {
        _bridge.Dispose();
        _overlay.Close();
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class DesktopBridge : IDisposable
{
    private const string Prefix = "http://127.0.0.1:47831/";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly HttpListener _listener = new();
    private readonly SpiderOverlay _overlay;
    private readonly NotifyIcon _tray;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly object _clientLock = new();
    private WebSocket? _client;
    private CancellationTokenSource? _scanCancellation;
    private int _scanActive;

    public DesktopBridge(SpiderOverlay overlay, NotifyIcon tray)
    {
        _overlay = overlay;
        _tray = tray;
    }

    public void Start()
    {
        _listener.Prefixes.Add(Prefix);
        _listener.Start();
        _ = AcceptLoopAsync(_shutdown.Token);
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var context = await _listener.GetContextAsync();
                await HandleRequestAsync(context, cancellationToken);
            }
        }
        catch (HttpListenerException) when (cancellationToken.IsCancellationRequested) { }
        catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception ex)
        {
            _tray.ShowBalloonTip(5000, "Doc Forager 桌面桥接异常", ex.Message, ToolTipIcon.Error);
        }
    }

    private async Task HandleRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        if (!context.Request.IsWebSocketRequest ||
            !string.Equals(context.Request.Url?.AbsolutePath, "/forager", StringComparison.Ordinal) ||
            !IsAllowedOrigin(context.Request.Headers["Origin"]))
        {
            context.Response.StatusCode = 404;
            context.Response.Close();
            return;
        }

        var accepted = await context.AcceptWebSocketAsync(null);
        var socket = accepted.WebSocket;
        lock (_clientLock)
        {
            _client?.Abort();
            _client = socket;
        }

        try
        {
            await SendAsync(new { type = "ready" }, cancellationToken);
            await ReceiveLoopAsync(socket, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (WebSocketException) { }
        finally
        {
            _scanCancellation?.Cancel();
            _overlay.ClearOverlay();
            lock (_clientLock)
            {
                if (ReferenceEquals(_client, socket)) _client = null;
            }
            socket.Dispose();
        }
    }

    private static bool IsAllowedOrigin(string? origin)
    {
        if (string.Equals(origin, "null", StringComparison.Ordinal)) return true;
        return Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
               uri.IsLoopback;
    }

    private async Task ReceiveLoopAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    if (socket.State == WebSocketState.CloseReceived)
                    {
                        await socket.CloseOutputAsync(
                            result.CloseStatus ?? WebSocketCloseStatus.NormalClosure,
                            result.CloseStatusDescription,
                            cancellationToken);
                    }
                    return;
                }
                if (message.Length + result.Count > 64 * 1024)
                {
                    await SendAsync(new { type = "bridge-error", message = "控制消息超过大小限制" }, cancellationToken);
                    return;
                }
                message.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
            {
                await SendAsync(new { type = "bridge-error", message = "只接受文本控制消息" }, cancellationToken);
                continue;
            }

            try
            {
                using var json = JsonDocument.Parse(message.ToArray());
                await DispatchAsync(json.RootElement, cancellationToken);
            }
            catch (JsonException)
            {
                await SendAsync(new { type = "bridge-error", message = "控制消息不是有效 JSON" }, cancellationToken);
            }
        }
    }

    private async Task DispatchAsync(JsonElement message, CancellationToken cancellationToken)
    {
        if (message.ValueKind != JsonValueKind.Object ||
            !message.TryGetProperty("type", out var typeValue) ||
            typeValue.ValueKind != JsonValueKind.String)
        {
            await SendAsync(new { type = "bridge-error", message = "控制消息缺少 type" }, cancellationToken);
            return;
        }

        switch (typeValue.GetString())
        {
            case "hello":
                await SendAsync(new { type = "ready" }, cancellationToken);
                break;
            case "start-scan":
                if (Interlocked.CompareExchange(ref _scanActive, 1, 0) != 0)
                {
                    await SendAsync(new { type = "scan-error", message = "已有整屏读取正在进行" }, cancellationToken);
                    return;
                }
                _scanCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                _ = RunScanAsync(_scanCancellation.Token);
                break;
            case "cancel-scan":
                _scanCancellation?.Cancel();
                _overlay.ClearOverlay();
                break;
            case "clear-overlay":
                _overlay.ClearOverlay();
                break;
            default:
                await SendAsync(new { type = "bridge-error", message = "未知的桌面桥接命令" }, cancellationToken);
                break;
        }
    }

    private async Task RunScanAsync(CancellationToken cancellationToken)
    {
        try
        {
            var result = await DesktopOcr.ReadVirtualScreenAsync(cancellationToken);
            _overlay.ShowOverlay();
            _overlay.SetCrawlSpeed(result.Blocks.Count);
            foreach (var block in result.Blocks)
            {
                cancellationToken.ThrowIfCancellationRequested();
                _overlay.CrawlTo(new OverlayTarget(
                    block.X + block.Width / 2,
                    block.Y + block.Height / 2));
            }
            await SendAsync(new
            {
                type = "scan-complete",
                result.VirtualScreen,
                result.Blocks
            }, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await SendAsync(new { type = "scan-cancelled" }, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _overlay.ClearOverlay();
            _tray.ShowBalloonTip(5000, "Doc Forager 整屏读取失败", ex.Message, ToolTipIcon.Error);
            try
            {
                await SendAsync(new { type = "scan-error", message = ex.Message }, CancellationToken.None);
            }
            catch (WebSocketException)
            {
                _tray.ShowBalloonTip(3500, "Doc Forager 桌面桥接", "网页连接已断开，读取结果未能传回。", ToolTipIcon.Warning);
            }
        }
        finally
        {
            Interlocked.Exchange(ref _scanActive, 0);
            _scanCancellation?.Dispose();
            _scanCancellation = null;
        }
    }

    private async Task SendAsync(object payload, CancellationToken cancellationToken)
    {
        WebSocket? socket;
        lock (_clientLock) socket = _client;
        if (socket?.State != WebSocketState.Open) return;

        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            const int chunkSize = 16 * 1024;
            for (var offset = 0; offset < bytes.Length; offset += chunkSize)
            {
                var count = Math.Min(chunkSize, bytes.Length - offset);
                await socket.SendAsync(
                    new ArraySegment<byte>(bytes, offset, count),
                    WebSocketMessageType.Text,
                    offset + count == bytes.Length,
                    cancellationToken);
            }
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private static bool ReadFinite(JsonElement json, string name, out double value)
    {
        value = 0;
        return json.TryGetProperty(name, out var property) &&
               property.ValueKind == JsonValueKind.Number &&
               property.TryGetDouble(out value) &&
               double.IsFinite(value);
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        _scanCancellation?.Cancel();
        _listener.Close();
        _sendLock.Dispose();
        _shutdown.Dispose();
    }
}

internal static class NativeMethods
{
    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int index);

    internal static Rectangle GetVirtualScreen()
    {
        const int x = 76, y = 77, width = 78, height = 79;
        return new Rectangle(GetSystemMetrics(x), GetSystemMetrics(y),
                             GetSystemMetrics(width), GetSystemMetrics(height));
    }
}
