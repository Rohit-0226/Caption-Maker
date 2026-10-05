using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using UiTimer = System.Windows.Forms.Timer;

namespace CaptionMakerLauncher
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        public static string s_rebuildWarning = null;

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                File.AppendAllText("launcher\\trace.log", "1. Main entry\r\n");
                try
                {
                    SetProcessDPIAware();
                }
                catch {}

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) {
                    try { File.AppendAllText("launcher\\crash.log", "ThreadException: " + e.Exception.ToString() + "\r\n"); } catch {}
                };
                AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) {
                    try { File.AppendAllText("launcher\\crash.log", "UnhandledException: " + e.ExceptionObject.ToString() + "\r\n"); } catch {}
                };

                string exePath = Assembly.GetEntryAssembly().Location;
                string projectRoot = Path.GetDirectoryName(exePath);
                try { Directory.SetCurrentDirectory(projectRoot); } catch {}

                string screenshotPath = null;
                bool exitAfterScreenshot = false;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i].Equals("--screenshot", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    {
                        screenshotPath = args[++i];
                    }
                    else if (args[i].Equals("--exit-after-screenshot", StringComparison.OrdinalIgnoreCase))
                    {
                        exitAfterScreenshot = true;
                    }
                }

                File.AppendAllText("launcher\\trace.log", "2. Before CheckSelfUpdate\r\n");
                CheckSelfUpdate();
                File.AppendAllText("launcher\\trace.log", "3. After CheckSelfUpdate\r\n");

                bool isNewInstance;
                using (Mutex mutex = new Mutex(true, "Local\\CaptionMaker_WebShare_Launcher_Mutex", out isNewInstance))
                {
                    File.AppendAllText("launcher\\trace.log", "4. Mutex isNewInstance=" + isNewInstance + "\r\n");
                    if (!isNewInstance)
                    {
                        IntPtr existing = FindWindow(null, MainForm.WINDOW_TITLE);
                        if (existing != IntPtr.Zero)
                        {
                            ShowWindow(existing, 9); // SW_RESTORE
                            SetForegroundWindow(existing);
                            return;
                        }

                        // Wait a moment in case the existing window is initializing
                        Thread.Sleep(800);
                        existing = FindWindow(null, MainForm.WINDOW_TITLE);
                        if (existing != IntPtr.Zero)
                        {
                            ShowWindow(existing, 9);
                            SetForegroundWindow(existing);
                            return;
                        }

                        // If no window found on this desktop, an orphaned background instance was holding the mutex.
                        // Terminate orphaned background instances so this interactive window can open cleanly.
                        int currentPid = Process.GetCurrentProcess().Id;
                        try
                        {
                            foreach (Process p in Process.GetProcessesByName("Caption Maker Web & Share"))
                            {
                                if (p.Id != currentPid)
                                {
                                    try { p.Kill(); } catch {}
                                }
                            }
                        }
                        catch {}
                        Thread.Sleep(500);
                    }

                    File.AppendAllText("launcher\\trace.log", "5. Before Application.Run\r\n");
                    Application.Run(new MainForm(screenshotPath, exitAfterScreenshot));
                    File.AppendAllText("launcher\\trace.log", "6. After Application.Run\r\n");
                }
            }
            catch (Exception ex)
            {
                try
                {
                    File.AppendAllText("launcher\\trace.log", "CRASH: " + ex.ToString() + "\r\n");
                }
                catch {}
            }
        }

        private static void CheckSelfUpdate()
        {
            try
            {
                string exePath = Assembly.GetEntryAssembly().Location;
                string projectRoot = Path.GetDirectoryName(exePath);
                string launcherDir = Path.Combine(projectRoot, "launcher");
                string csFile = Path.Combine(launcherDir, "Launcher.cs");

                if (!File.Exists(csFile)) return;

                DateTime exeTime = File.GetLastWriteTimeUtc(exePath);
                DateTime csTime = File.GetLastWriteTimeUtc(csFile);

                // Clean up any old backups from previous updates
                try
                {
                    string[] oldFiles = Directory.GetFiles(projectRoot, "*.old-*");
                    for (int i = 0; i < oldFiles.Length; i++)
                    {
                        try { File.Delete(oldFiles[i]); } catch {}
                    }
                }
                catch {}

                if (csTime <= exeTime) return;

                // Check if this specific source timestamp already failed
                string failStampFile = Path.Combine(launcherDir, ".rebuild_failed");
                if (File.Exists(failStampFile))
                {
                    try
                    {
                        string recorded = File.ReadAllText(failStampFile).Trim();
                        if (recorded == csTime.Ticks.ToString())
                        {
                            s_rebuildWarning = "Launcher source modified, but previous compile failed. See launcher/build.log";
                            return;
                        }
                    }
                    catch {}
                }

                // Show a splash form while compiling
                Form splash = new Form();
                splash.FormBorderStyle = FormBorderStyle.None;
                splash.StartPosition = FormStartPosition.CenterScreen;
                splash.Size = new Size(380, 110);
                splash.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
                splash.TopMost = true;

                Label lbl = new Label();
                lbl.ForeColor = Color.FromArgb(248, 250, 252);
                lbl.Font = new Font("Segoe UI", 11, FontStyle.Regular);
                lbl.Text = "Updating Caption Maker Web & Share launcher...\nPlease wait while recompiling.";
                lbl.Dock = DockStyle.Fill;
                lbl.TextAlign = ContentAlignment.MiddleCenter;
                splash.Controls.Add(lbl);
                splash.Show();
                splash.Refresh();

                string cscPath = @"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe";
                if (!File.Exists(cscPath))
                {
                    cscPath = @"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe";
                }

                string binDir = Path.Combine(launcherDir, "bin");
                if (!Directory.Exists(binDir)) Directory.CreateDirectory(binDir);
                string tempOut = Path.Combine(binDir, "update_" + Guid.NewGuid().ToString("N") + ".exe");
                string icoPath = Path.Combine(launcherDir, "icon.ico");

                StringBuilder sb = new StringBuilder();
                sb.Append("/target:winexe /optimize+ ");
                if (File.Exists(icoPath))
                {
                    sb.Append(string.Format("/win32icon:\"{0}\" ", icoPath));
                }
                sb.Append(string.Format("/out:\"{0}\" \"{1}\"", tempOut, csFile));

                ProcessStartInfo psi = new ProcessStartInfo(cscPath, sb.ToString());
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                Process p = Process.Start(psi);
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();

                splash.Close();
                splash.Dispose();

                if (p.ExitCode == 0 && File.Exists(tempOut))
                {
                    if (File.Exists(failStampFile))
                    {
                        try { File.Delete(failStampFile); } catch {}
                    }

                    string oldExe = exePath + ".old-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                    File.Move(exePath, oldExe);
                    File.Move(tempOut, exePath);

                    Process.Start(exePath);
                    Environment.Exit(0);
                }
                else
                {
                    string logFile = Path.Combine(launcherDir, "build.log");
                    File.WriteAllText(logFile, stdout + "\r\n" + stderr);
                    File.WriteAllText(failStampFile, csTime.Ticks.ToString());
                    s_rebuildWarning = "Self-update compile failed; running existing build. See launcher/build.log";
                }
            }
            catch (Exception ex)
            {
                s_rebuildWarning = "Self-update check error: " + ex.Message;
            }
        }
    }

    #region Job Object Win32 Helpers
    internal static class JobObject
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryLimit;
            public UIntPtr PeakJobMemoryLimit;
        }

        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr hJob = CreateJobObject(IntPtr.Zero, null);
            if (hJob == IntPtr.Zero) return IntPtr.Zero;

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr pInfo = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, pInfo, false);
                if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, pInfo, (uint)length))
                {
                    CloseHandle(hJob);
                    return IntPtr.Zero;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(pInfo);
            }
            return hJob;
        }
    }
    #endregion

    #region Port Detection via iphlpapi
    internal static class PortManager
    {
        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(IntPtr pTcpTable, ref int pdwSize, bool bOrder, uint ulAf, int TableClass, uint Reserved);

        private const uint AF_INET = 2;
        private const uint AF_INET6 = 23;
        private const int TCP_TABLE_OWNER_PID_ALL = 5;

        public static List<int> GetPidsForPort(int port)
        {
            List<int> pids = new List<int>();
            pids.AddRange(GetPidsForPortFamily(port, AF_INET));
            pids.AddRange(GetPidsForPortFamily(port, AF_INET6));
            return pids;
        }

        private static List<int> GetPidsForPortFamily(int port, uint family)
        {
            List<int> result = new List<int>();
            int bufferSize = 0;
            uint ret = GetExtendedTcpTable(IntPtr.Zero, ref bufferSize, false, family, TCP_TABLE_OWNER_PID_ALL, 0);

            IntPtr tcpTablePtr = Marshal.AllocHGlobal(bufferSize);
            try
            {
                ret = GetExtendedTcpTable(tcpTablePtr, ref bufferSize, false, family, TCP_TABLE_OWNER_PID_ALL, 0);
                if (ret != 0) return result;

                int numEntries = Marshal.ReadInt32(tcpTablePtr);
                IntPtr rowPtr = (IntPtr)((long)tcpTablePtr + 4);

                if (family == AF_INET)
                {
                    // MIB_TCPROW_OWNER_PID structure size: 24 bytes
                    int rowSize = 24;
                    for (int i = 0; i < numEntries; i++)
                    {
                        byte p1 = Marshal.ReadByte(rowPtr, 8);
                        byte p2 = Marshal.ReadByte(rowPtr, 9);
                        int rowPort = (p1 << 8) | p2;
                        int pid = Marshal.ReadInt32(rowPtr, 20);

                        if (rowPort == port && pid > 0 && !result.Contains(pid))
                        {
                            result.Add(pid);
                        }
                        rowPtr = (IntPtr)((long)rowPtr + rowSize);
                    }
                }
                else
                {
                    // MIB_TCP6ROW_OWNER_PID structure size: 56 bytes
                    int rowSize = 56;
                    for (int i = 0; i < numEntries; i++)
                    {
                        byte p1 = Marshal.ReadByte(rowPtr, 20);
                        byte p2 = Marshal.ReadByte(rowPtr, 21);
                        int rowPort = (p1 << 8) | p2;
                        int pid = Marshal.ReadInt32(rowPtr, 52);

                        if (rowPort == port && pid > 0 && !result.Contains(pid))
                        {
                            result.Add(pid);
                        }
                        rowPtr = (IntPtr)((long)rowPtr + rowSize);
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(tcpTablePtr);
            }
            return result;
        }
    }
    #endregion

    public class MainForm : Form
    {
        public const string WINDOW_TITLE = "Caption Maker - Web Hub & Cloudflare Tunnel";
        private const int WEB_PORT = 5173;
        private const int SERVER_PORT = 5180;

        private string m_projectRoot;
        private string m_launcherDir;
        private string m_logPath;
        private string m_statePath;
        private string m_depsHashPath;

        private IntPtr m_hJob = IntPtr.Zero;
        private Process m_devProcess = null;
        private Process m_tunnelProcess = null;
        private StreamWriter m_devStdin = null;

        // Another app (the desktop window) may already run the dev stack. Then this
        // launcher only shares it - tunnel and links - and must never clear its
        // ports, restart it or stop it, because it did not start it.
        private const int TAKEOVER_AFTER_SECONDS = 20;
        private bool m_attached = false;
        private string m_attachedOwner = null;
        private DateTime m_attachedDownSinceUtc = DateTime.MinValue;
        private int m_attachedCheckBusy = 0;
        // Put in the stack's environment and echoed by /api/health, so the launcher
        // can tell its own stack from one another app started at the same moment.
        private string m_ownerTag;

        private bool m_browserOpened = false;
        private bool m_isStopping = false;
        private bool m_sharePublicLink = true;
        private string m_tunnelUrl = null;
        private bool m_tunnelIsLive = false;
        private int m_tunnelRestartAttempts = 0;
        private DateTime m_nextTunnelAttemptUtc = DateTime.MinValue;

        // UI Controls
        private Panel m_pnlStatusDot;
        private Label m_lblStatusText;
        private Label m_lblSubStatus;

        private Label m_lblLocalLink;
        private Label m_lblLanLink;
        private Label m_lblPublicLink;
        private Label m_lblPublicStatus;
        private Button m_btnCopyLocal;
        private Button m_btnCopyLan;
        private Button m_btnCopyPublic;
        private Button m_btnOpenLocal;
        private Button m_btnOpenLan;
        private Button m_btnOpenPublic;

        private Button m_btnOpenBrowser;
        private Button m_btnStartRestart;
        private Button m_btnStop;
        private Button m_btnViewLogs;
        private CheckBox m_chkSharePublic;

        private RichTextBox m_rtbLogs;
        private Label m_lblFooterLeft;
        private Label m_lblFooterCenter;
        private Label m_lblFooterRight;

        private UiTimer m_pollTimer;
        private FileSystemWatcher m_watcher;
        private System.Threading.Timer m_debounceTimer;
        private List<string> m_pendingChangedFiles = new List<string>();
        private object m_watcherLock = new object();
        private string m_screenshotPath = null;
        private bool m_exitAfterScreenshot = false;

        public MainForm() : this(null, false)
        {
        }

        public MainForm(string screenshotPath, bool exitAfterScreenshot)
        {
            m_screenshotPath = screenshotPath;
            m_exitAfterScreenshot = exitAfterScreenshot;

            m_projectRoot = Path.GetDirectoryName(Assembly.GetEntryAssembly().Location);
            m_launcherDir = Path.Combine(m_projectRoot, "launcher");
            m_logPath = Path.Combine(m_launcherDir, "logs", "launcher.log");
            m_statePath = Path.Combine(m_launcherDir, "state.json");
            m_depsHashPath = Path.Combine(m_launcherDir, ".deps.hash");
            m_ownerTag = "launcher:" + Process.GetCurrentProcess().Id;

            if (!Directory.Exists(Path.GetDirectoryName(m_logPath)))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(m_logPath));
            }

            m_hJob = JobObject.CreateKillOnCloseJob();

            LoadState();
            InitializeComponent();
            ApplyTheme();

            if (Program.s_rebuildWarning != null)
            {
                m_lblFooterCenter.Text = Program.s_rebuildWarning;
                m_lblFooterCenter.ForeColor = Color.FromArgb(251, 191, 36);
                LogWarning("[Launcher] " + Program.s_rebuildWarning);
            }

            SetupWatcher();

            m_pollTimer = new UiTimer();
            m_pollTimer.Interval = 2000;
            m_pollTimer.Tick += new EventHandler(OnPollTimerTick);
            m_pollTimer.Start();

            // Start preflight & launch sequence on shown
            this.Shown += new EventHandler(OnFormShown);
        }

        private void InitializeComponent()
        {
            this.Text = WINDOW_TITLE;
            this.Size = new Size(980, 720);
            this.MinimumSize = new Size(840, 600);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 13, 17);
            this.ForeColor = Color.FromArgb(243, 244, 246);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular);

            // Load Window Icon if present
            try
            {
                string icoPath = Path.Combine(m_launcherDir, "icon.ico");
                if (File.Exists(icoPath))
                {
                    this.Icon = new Icon(icoPath);
                }
            }
            catch {}

            // Root Layout: TableLayoutPanel
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 5;
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 70F));  // Header
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 185F)); // Links card
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46F));  // Action buttons
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));  // Log pane
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 28F));  // Footer
            root.Padding = new Padding(14, 10, 14, 8);
            this.Controls.Add(root);

            // 1. Header Panel
            Panel headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Fill;
            headerPanel.BackColor = Color.Transparent;

            Label titleLabel = new Label();
            titleLabel.Text = "Caption Maker Web & Share";
            titleLabel.UseMnemonic = false;
            titleLabel.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            titleLabel.ForeColor = Color.White;
            titleLabel.Location = new Point(0, 4);
            titleLabel.AutoSize = true;
            headerPanel.Controls.Add(titleLabel);

            m_lblSubStatus = new Label();
            m_lblSubStatus.Text = "Local Web Client, LAN & Remote Cloudflare Tunnel";
            m_lblSubStatus.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular);
            m_lblSubStatus.ForeColor = Color.FromArgb(156, 163, 175);
            m_lblSubStatus.Location = new Point(2, 30);
            m_lblSubStatus.AutoSize = true;
            headerPanel.Controls.Add(m_lblSubStatus);

            // Status Pill (Right aligned inside header)
            Panel pillPanel = new Panel();
            pillPanel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            pillPanel.Location = new Point(headerPanel.Width - 230, 8);
            pillPanel.Size = new Size(220, 32);
            pillPanel.BackColor = Color.FromArgb(24, 27, 34);
            pillPanel.Paint += new PaintEventHandler(PaintPillBorder);
            headerPanel.Resize += delegate(object s, EventArgs e) {
                pillPanel.Location = new Point(headerPanel.Width - 230, 8);
            };

            m_pnlStatusDot = new Panel();
            m_pnlStatusDot.Size = new Size(10, 10);
            m_pnlStatusDot.Location = new Point(12, 11);
            m_pnlStatusDot.BackColor = Color.FromArgb(59, 130, 246); // Blue starting
            m_pnlStatusDot.Paint += new PaintEventHandler(PaintCircle);
            pillPanel.Controls.Add(m_pnlStatusDot);

            m_lblStatusText = new Label();
            m_lblStatusText.Text = "Starting up...";
            m_lblStatusText.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            m_lblStatusText.ForeColor = Color.FromArgb(243, 244, 246);
            m_lblStatusText.Location = new Point(28, 7);
            m_lblStatusText.Size = new Size(185, 20);
            pillPanel.Controls.Add(m_lblStatusText);

            headerPanel.Controls.Add(pillPanel);
            root.Controls.Add(headerPanel, 0, 0);

            // 2. Links Card Panel
            Panel linksCard = new Panel();
            linksCard.Dock = DockStyle.Fill;
            linksCard.BackColor = Color.FromArgb(20, 24, 33);
            linksCard.Padding = new Padding(14, 10, 14, 10);
            linksCard.Paint += new PaintEventHandler(PaintCardBorder);

            TableLayoutPanel linksTable = new TableLayoutPanel();
            linksTable.Dock = DockStyle.Fill;
            linksTable.ColumnCount = 4;
            linksTable.RowCount = 3;
            linksTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220F)); // Name
            linksTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));  // URL
            linksTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 70F));  // Open
            linksTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 70F));  // Copy
            linksTable.RowStyles.Add(new RowStyle(SizeType.Percent, 33.3F));
            linksTable.RowStyles.Add(new RowStyle(SizeType.Percent, 33.3F));
            linksTable.RowStyles.Add(new RowStyle(SizeType.Percent, 33.4F));
            linksCard.Controls.Add(linksTable);

            // Row 0: Local
            Label lblNameLocal = new Label();
            lblNameLocal.Text = "💻 This computer:";
            lblNameLocal.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            lblNameLocal.ForeColor = Color.FromArgb(209, 213, 219);
            lblNameLocal.Dock = DockStyle.Fill;
            lblNameLocal.TextAlign = ContentAlignment.MiddleLeft;
            linksTable.Controls.Add(lblNameLocal, 0, 0);

            m_lblLocalLink = new Label();
            m_lblLocalLink.Text = string.Format("http://localhost:{0}", WEB_PORT);
            m_lblLocalLink.Font = new Font("Consolas", 9.5F, FontStyle.Regular);
            m_lblLocalLink.ForeColor = Color.FromArgb(96, 165, 250);
            m_lblLocalLink.Dock = DockStyle.Fill;
            m_lblLocalLink.TextAlign = ContentAlignment.MiddleLeft;
            linksTable.Controls.Add(m_lblLocalLink, 1, 0);

            m_btnOpenLocal = CreateSmallButton("Open", delegate { OpenUrl(m_lblLocalLink.Text); });
            linksTable.Controls.Add(m_btnOpenLocal, 2, 0);
            m_btnCopyLocal = CreateSmallButton("Copy", delegate { CopyToClipboard(m_lblLocalLink.Text); });
            linksTable.Controls.Add(m_btnCopyLocal, 3, 0);

            // Row 1: LAN Wi-Fi
            Label lblNameLan = new Label();
            lblNameLan.Text = "📱 Same Wi-Fi (LAN):";
            lblNameLan.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            lblNameLan.ForeColor = Color.FromArgb(209, 213, 219);
            lblNameLan.Dock = DockStyle.Fill;
            lblNameLan.TextAlign = ContentAlignment.MiddleLeft;
            linksTable.Controls.Add(lblNameLan, 0, 1);

            string lanIp = GetActiveLanIp();
            m_lblLanLink = new Label();
            m_lblLanLink.Text = string.Format("http://{0}:{1}", lanIp, WEB_PORT);
            m_lblLanLink.Font = new Font("Consolas", 9.5F, FontStyle.Regular);
            m_lblLanLink.ForeColor = Color.FromArgb(96, 165, 250);
            m_lblLanLink.Dock = DockStyle.Fill;
            m_lblLanLink.TextAlign = ContentAlignment.MiddleLeft;
            linksTable.Controls.Add(m_lblLanLink, 1, 1);

            m_btnOpenLan = CreateSmallButton("Open", delegate { OpenUrl(m_lblLanLink.Text); });
            linksTable.Controls.Add(m_btnOpenLan, 2, 1);
            m_btnCopyLan = CreateSmallButton("Copy", delegate { CopyToClipboard(m_lblLanLink.Text); });
            linksTable.Controls.Add(m_btnCopyLan, 3, 1);

            // Row 2: Cloudflare Public Link
            Panel publicNamePanel = new Panel();
            publicNamePanel.Dock = DockStyle.Fill;
            Label lblNamePublic = new Label();
            lblNamePublic.Text = "🌐 Anywhere (Public Link):";
            lblNamePublic.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            lblNamePublic.ForeColor = Color.FromArgb(209, 213, 219);
            lblNamePublic.Location = new Point(0, 8);
            lblNamePublic.AutoSize = true;
            publicNamePanel.Controls.Add(lblNamePublic);

            m_lblPublicStatus = new Label();
            m_lblPublicStatus.Text = "(initializing...)";
            m_lblPublicStatus.Font = new Font("Segoe UI", 7.5F, FontStyle.Italic);
            m_lblPublicStatus.ForeColor = Color.FromArgb(156, 163, 175);
            m_lblPublicStatus.Location = new Point(0, 28);
            m_lblPublicStatus.AutoSize = true;
            publicNamePanel.Controls.Add(m_lblPublicStatus);
            linksTable.Controls.Add(publicNamePanel, 0, 2);

            m_lblPublicLink = new Label();
            m_lblPublicLink.Text = "Waiting for tunnel...";
            m_lblPublicLink.Font = new Font("Consolas", 9.5F, FontStyle.Regular);
            m_lblPublicLink.ForeColor = Color.FromArgb(156, 163, 175);
            m_lblPublicLink.Dock = DockStyle.Fill;
            m_lblPublicLink.TextAlign = ContentAlignment.MiddleLeft;

            ToolTip tt = new ToolTip();
            tt.SetToolTip(m_lblPublicLink, "Anyone with this link can use the whole app, including editing projects and settings, until the launcher closes.");
            linksTable.Controls.Add(m_lblPublicLink, 1, 2);

            m_btnOpenPublic = CreateSmallButton("Open", delegate {
                if (m_tunnelUrl != null && m_tunnelIsLive) OpenUrl(m_tunnelUrl);
            });
            m_btnOpenPublic.Enabled = false;
            linksTable.Controls.Add(m_btnOpenPublic, 2, 2);

            m_btnCopyPublic = CreateSmallButton("Copy", delegate {
                if (m_tunnelUrl != null && m_tunnelIsLive) CopyToClipboard(m_tunnelUrl);
            });
            m_btnCopyPublic.Enabled = false;
            linksTable.Controls.Add(m_btnCopyPublic, 3, 2);

            root.Controls.Add(linksCard, 0, 1);

            // 3. Action Buttons & Options Bar
            TableLayoutPanel actionsBar = new TableLayoutPanel();
            actionsBar.Dock = DockStyle.Fill;
            actionsBar.ColumnCount = 2;
            actionsBar.RowCount = 1;
            actionsBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            actionsBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionsBar.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            actionsBar.Margin = new Padding(0);

            FlowLayoutPanel leftButtons = new FlowLayoutPanel();
            leftButtons.Dock = DockStyle.Fill;
            leftButtons.FlowDirection = FlowDirection.LeftToRight;
            leftButtons.WrapContents = false;
            leftButtons.AutoSize = false;
            leftButtons.Margin = new Padding(0);

            m_btnOpenBrowser = CreateMainButton("🌐 Open in Browser", delegate {
                OpenUrl(string.Format("http://localhost:{0}", WEB_PORT));
            });
            leftButtons.Controls.Add(m_btnOpenBrowser);

            m_btnStartRestart = CreateMainButton("🔄 Restart", new EventHandler(OnStartRestartClick));
            leftButtons.Controls.Add(m_btnStartRestart);

            m_btnStop = CreateMainButton("⏹ Stop", delegate {
                StopServers();
            });
            leftButtons.Controls.Add(m_btnStop);

            m_btnViewLogs = CreateMainButton("📄 Log File", delegate {
                OpenLogFile();
            });
            leftButtons.Controls.Add(m_btnViewLogs);

            actionsBar.Controls.Add(leftButtons, 0, 0);

            m_chkSharePublic = new CheckBox();
            m_chkSharePublic.Text = "Share a public link (Cloudflare Quick Tunnel)";
            m_chkSharePublic.Checked = m_sharePublicLink;
            m_chkSharePublic.Font = new Font("Segoe UI", 9F, FontStyle.Regular);
            m_chkSharePublic.ForeColor = Color.FromArgb(229, 231, 235);
            m_chkSharePublic.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            m_chkSharePublic.AutoSize = true;
            m_chkSharePublic.Padding = new Padding(0, 6, 4, 0);
            m_chkSharePublic.CheckedChanged += new EventHandler(OnSharePublicChanged);
            actionsBar.Controls.Add(m_chkSharePublic, 1, 0);

            root.Controls.Add(actionsBar, 0, 2);

            // 4. Live Logs Pane
            m_rtbLogs = new RichTextBox();
            m_rtbLogs.Dock = DockStyle.Fill;
            m_rtbLogs.BackColor = Color.FromArgb(18, 21, 27);
            m_rtbLogs.ForeColor = Color.FromArgb(226, 232, 240);
            m_rtbLogs.Font = new Font("Consolas", 9.5F, FontStyle.Regular);
            m_rtbLogs.ReadOnly = true;
            m_rtbLogs.BorderStyle = BorderStyle.None;
            m_rtbLogs.ScrollBars = RichTextBoxScrollBars.Vertical;
            m_rtbLogs.WordWrap = false;
            root.Controls.Add(m_rtbLogs, 0, 3);

            // 5. Footer Panel
            TableLayoutPanel footer = new TableLayoutPanel();
            footer.Dock = DockStyle.Fill;
            footer.ColumnCount = 3;
            footer.RowCount = 1;
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35F));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35F));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30F));

            m_lblFooterLeft = new Label();
            m_lblFooterLeft.Text = "● Watching for changes";
            m_lblFooterLeft.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
            m_lblFooterLeft.Font = new Font("Segoe UI", 8F);
            m_lblFooterLeft.Dock = DockStyle.Fill;
            m_lblFooterLeft.TextAlign = ContentAlignment.MiddleLeft;
            footer.Controls.Add(m_lblFooterLeft, 0, 0);

            DateTime exeBuilt = File.GetLastWriteTime(Assembly.GetEntryAssembly().Location);
            m_lblFooterCenter = new Label();
            m_lblFooterCenter.Text = "Built: " + exeBuilt.ToString("yyyy-MM-dd HH:mm");
            m_lblFooterCenter.ForeColor = Color.FromArgb(156, 163, 175);
            m_lblFooterCenter.Font = new Font("Segoe UI", 8F);
            m_lblFooterCenter.Dock = DockStyle.Fill;
            m_lblFooterCenter.TextAlign = ContentAlignment.MiddleCenter;
            footer.Controls.Add(m_lblFooterCenter, 1, 0);

            m_lblFooterRight = new Label();
            m_lblFooterRight.Text = "Log: launcher/logs/launcher.log";
            m_lblFooterRight.ForeColor = Color.FromArgb(156, 163, 175);
            m_lblFooterRight.Font = new Font("Segoe UI", 8F);
            m_lblFooterRight.Dock = DockStyle.Fill;
            m_lblFooterRight.TextAlign = ContentAlignment.MiddleRight;
            footer.Controls.Add(m_lblFooterRight, 2, 0);

            root.Controls.Add(footer, 0, 4);

            this.FormClosing += new FormClosingEventHandler(OnFormClosing);
        }

        private Button CreateSmallButton(string text, EventHandler onClick)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Size = new Size(62, 28);
            btn.BackColor = Color.FromArgb(31, 41, 55);
            btn.ForeColor = Color.FromArgb(243, 244, 246);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            btn.Font = new Font("Segoe UI", 8F, FontStyle.Regular);
            btn.Cursor = Cursors.Hand;
            btn.Margin = new Padding(3, 4, 3, 4);
            btn.Click += onClick;
            return btn;
        }

        private Button CreateMainButton(string text, EventHandler onClick)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Height = 32;
            btn.AutoSize = true;
            btn.BackColor = Color.FromArgb(31, 41, 55);
            btn.ForeColor = Color.FromArgb(243, 244, 246);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            btn.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            btn.Margin = new Padding(0, 4, 8, 4);
            btn.Padding = new Padding(8, 0, 8, 0);
            btn.Click += onClick;
            return btn;
        }

        private void PaintPillBorder(object sender, PaintEventArgs e)
        {
            Panel p = sender as Panel;
            if (p == null) return;
            using (Pen pen = new Pen(Color.FromArgb(45, 55, 72), 1))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1);
            }
        }

        private void PaintCardBorder(object sender, PaintEventArgs e)
        {
            Panel p = sender as Panel;
            if (p == null) return;
            using (Pen pen = new Pen(Color.FromArgb(38, 45, 59), 1))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1);
            }
        }

        private void PaintCircle(object sender, PaintEventArgs e)
        {
            Panel p = sender as Panel;
            if (p == null) return;
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (SolidBrush brush = new SolidBrush(p.BackColor))
            {
                e.Graphics.FillEllipse(brush, 0, 0, p.Width - 1, p.Height - 1);
            }
        }

        private void ApplyTheme()
        {
            // Dark palette initialization
        }

        private void OnFormShown(object sender, EventArgs e)
        {
            StartServersAsync();

            if (!string.IsNullOrEmpty(m_screenshotPath))
            {
                ThreadPool.QueueUserWorkItem(delegate {
                    for (int waited = 0; waited < 35; waited++)
                    {
                        Thread.Sleep(1000);
                        if (m_tunnelIsLive || (!m_sharePublicLink && m_lblStatusText.Text == "Running"))
                        {
                            break;
                        }
                    }
                    Thread.Sleep(2000);
                    try
                    {
                        if (!this.IsDisposed && this.IsHandleCreated)
                        {
                            this.BeginInvoke(new Action(delegate {
                                CaptureWindow(m_screenshotPath);
                                if (m_exitAfterScreenshot)
                                {
                                    this.Close();
                                }
                            }));
                        }
                    }
                    catch {}
                });
            }
        }

        private void SetStatus(string text, Color dotColor, string subText)
        {
            if (this.IsDisposed || !this.IsHandleCreated) return;
            if (this.InvokeRequired)
            {
                try
                {
                    this.BeginInvoke(new Action(delegate { SetStatus(text, dotColor, subText); }));
                }
                catch {}
                return;
            }
            m_lblStatusText.Text = text;
            m_pnlStatusDot.BackColor = dotColor;
            m_pnlStatusDot.Invalidate();
            if (!string.IsNullOrEmpty(subText))
            {
                m_lblSubStatus.Text = subText;
            }
        }

        #region Launch Sequence
        private void StartServersAsync()
        {
            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    SetStatus("Preflight checks...", Color.FromArgb(59, 130, 246), "Verifying system requirements...");

                    // 1. Tooling Preflight
                    if (!RunToolPreflight()) return;

                    // 2. Already running? The desktop app may have started the stack;
                    //    then share it instead of clearing its ports and starting another.
                    SetStatus("Looking for a running stack...", Color.FromArgb(59, 130, 246), "Checking ports 5173 and 5180...");
                    string running = DetectRunningStack(25);
                    if (running != null)
                    {
                        EnterAttachedMode(running);
                        OnStackReady();
                        return;
                    }
                    m_attached = false;

                    // 3. Dependencies check
                    SetStatus("Checking dependencies...", Color.FromArgb(245, 158, 11), "Verifying node_modules content hash...");
                    if (!EnsureDependencies())
                    {
                        SetStatus("Install Failed", Color.FromArgb(239, 68, 68), "Check logs for npm install error");
                        return;
                    }

                    // 4. Clear Stale Ports (only reached when nothing healthy answers on them)
                    SetStatus("Clearing stale ports...", Color.FromArgb(59, 130, 246), "Checking port 5173 and 5180...");
                    ClearStalePorts();

                    // 5. Start Dev Process
                    SetStatus("Starting dev server...", Color.FromArgb(59, 130, 246), "Launching npm run dev...");
                    StartDevProcess();

                    // 6. Await Readiness
                    SetStatus("Waiting for readiness...", Color.FromArgb(59, 130, 246), "Polling health endpoints...");
                    bool ready = WaitForReadiness(45);

                    if (ready)
                    {
                        string health = ProbeCaptionMakerStack();
                        string owner = HealthField(health, "owner");
                        if (health != null && owner != m_ownerTag)
                        {
                            // Another app started its stack at the same moment and got the ports.
                            LogWarning("[Launcher] The stack that answered was started by " + DescribeOwner(owner) + "; stopping the copy started here.");
                            StopDevProcess();
                            EnterAttachedMode(health);
                        }
                        else
                        {
                            SetStatus("Running", Color.FromArgb(16, 185, 129), "Web client and API server active");
                            LogSuccess(string.Format("[Launcher] All services ready. Web: http://localhost:{0}, API: http://localhost:{1}", WEB_PORT, SERVER_PORT));
                        }
                        OnStackReady();
                    }
                    else
                    {
                        SetStatus("Timeout", Color.FromArgb(239, 68, 68), "Server failed to respond within 45s");
                        LogError("[Launcher] Readiness check timed out. Check output logs above.");
                    }
                }
                catch (Exception ex)
                {
                    SetStatus("Error", Color.FromArgb(239, 68, 68), ex.Message);
                    LogError("[Launcher] Start error: " + ex.ToString());
                }
            });
        }

        private void OnStackReady()
        {
            if (!m_browserOpened)
            {
                m_browserOpened = true;
                OpenUrl(string.Format("http://localhost:{0}", WEB_PORT));
            }

            // Start Public Tunnel if enabled
            if (m_sharePublicLink)
            {
                StartTunnelSupervisor();
            }
        }

        /// <summary>
        /// Body of /api/health fetched through the web server when both it and the
        /// API answer as Caption Maker, else null. Going through the web server's
        /// proxy proves the page and its API both work; the identity check keeps an
        /// unrelated program on these ports from being mistaken for the app.
        /// </summary>
        private string ProbeCaptionMakerStack()
        {
            string web = FetchHealth(string.Format("http://127.0.0.1:{0}/api/health", WEB_PORT));
            if (!IsCaptionMakerHealth(web)) return null;
            string api = FetchHealth(string.Format("http://127.0.0.1:{0}/api/health", SERVER_PORT));
            if (!IsCaptionMakerHealth(api)) return null;
            return web;
        }

        private string FetchHealth(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1500;
                req.ReadWriteTimeout = 1500;
                req.Method = "GET";
                req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)res.StatusCode != 200) return null;
                    using (StreamReader reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        // Servers from before the health identity answered {"ok":true} only; those do not count.
        private static bool IsCaptionMakerHealth(string body)
        {
            return body != null
                && Regex.IsMatch(body, "\"ok\"\\s*:\\s*true")
                && Regex.IsMatch(body, "\"app\"\\s*:\\s*\"caption-maker\"");
        }

        /// <summary>A string or number field from the health JSON; enough for its flat shape.</summary>
        private static string HealthField(string body, string name)
        {
            if (body == null) return null;
            Match m = Regex.Match(body, "\"" + name + "\"\\s*:\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|-?[0-9]+)");
            if (!m.Success) return null;
            if (m.Groups[2].Success)
            {
                try { return Regex.Unescape(m.Groups[2].Value); }
                catch { return m.Groups[2].Value; }
            }
            return m.Groups[1].Value;
        }

        private static string DescribeOwner(string owner)
        {
            if (string.IsNullOrEmpty(owner)) return "another process";
            if (owner.StartsWith("electron:", StringComparison.OrdinalIgnoreCase)) return "the Caption Maker desktop app";
            if (owner.StartsWith("launcher:", StringComparison.OrdinalIgnoreCase)) return "an earlier launcher";
            return owner;
        }

        private bool PortsBusy()
        {
            return PortManager.GetPidsForPort(WEB_PORT).Count > 0 || PortManager.GetPidsForPort(SERVER_PORT).Count > 0;
        }

        /// <summary>
        /// Looks for a Caption Maker stack that is already serving, such as one the
        /// desktop app started. Ports that are taken but not answering get a grace
        /// period first: a stack that is starting, or whose API is restarting after
        /// a code change, looks exactly like that for a few seconds, and clearing
        /// the ports then would kill it.
        /// </summary>
        private string DetectRunningStack(int graceSeconds)
        {
            string health = ProbeCaptionMakerStack();
            if (health != null) return health;
            if (!PortsBusy()) return null;

            Log(string.Format("[Ports] {0}/{1} are taken but not answering yet; waiting up to {2}s in case a stack is starting...", WEB_PORT, SERVER_PORT, graceSeconds));
            DateTime deadline = DateTime.UtcNow.AddSeconds(graceSeconds);
            while (DateTime.UtcNow < deadline && !m_isStopping)
            {
                Thread.Sleep(1000);
                health = ProbeCaptionMakerStack();
                if (health != null) return health;
                if (!PortsBusy()) return null;
            }
            return null;
        }

        private void EnterAttachedMode(string health)
        {
            m_attached = true;
            m_attachedOwner = HealthField(health, "owner");
            m_attachedDownSinceUtc = DateTime.MinValue;
            string who = DescribeOwner(m_attachedOwner);
            SetStatus("Running", Color.FromArgb(16, 185, 129), "Sharing the stack started by " + who);
            LogSuccess(string.Format("[Launcher] Caption Maker is already running (started by {0}, server PID {1}). Attached to it: nothing was started or stopped.", who, HealthField(health, "pid")));
            string dataDir = HealthField(health, "dataDir");
            if (dataDir != null) Log("[Launcher] Shared data folder: " + dataDir);
            Log("[Launcher] Closing this window stops only the public link; the stack keeps running for its owner.");
        }

        private bool RunToolPreflight()
        {
            Log("[Preflight] Checking required tools...");

            // Check Node.js
            string nodeVer = RunCommandQuiet("node", "-v");
            if (string.IsNullOrEmpty(nodeVer))
            {
                DialogResult dr = MessageBox.Show(
                    "Node.js was not found on your system.\n\nCaption Maker requires Node.js (v20+).\nWould you like to open the official download page?",
                    "Missing Requirement: Node.js",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Error
                );
                if (dr == DialogResult.Yes)
                {
                    OpenUrl("https://nodejs.org/");
                }
                SetStatus("Node Missing", Color.FromArgb(239, 68, 68), "Install Node.js from https://nodejs.org/");
                return false;
            }
            Log(string.Format("[Preflight] Node.js found: {0}", nodeVer.Trim()));

            // Check npm
            string npmVer = RunCommandQuiet("cmd.exe", "/c npm -v");
            if (string.IsNullOrEmpty(npmVer))
            {
                LogWarning("[Preflight] npm not found in PATH.");
            }
            else
            {
                Log(string.Format("[Preflight] npm found: {0}", npmVer.Trim()));
            }

            // Check FFmpeg
            string ffmpegPath = FindFfmpeg();
            if (string.IsNullOrEmpty(ffmpegPath))
            {
                LogWarning("[Preflight] FFmpeg was not found. Video transcoding may be limited.");
            }
            else
            {
                Log(string.Format("[Preflight] FFmpeg available at: {0}", ffmpegPath));
            }

            // Check cloudflared
            string cfPath = FindCloudflared();
            if (string.IsNullOrEmpty(cfPath))
            {
                LogWarning("[Preflight] cloudflared not found. Public link will be disabled until installed.");
                UpdatePublicLinkUI("cloudflared not installed", false);
            }
            else
            {
                Log(string.Format("[Preflight] cloudflared found: {0}", cfPath));
            }

            return true;
        }

        private bool EnsureDependencies()
        {
            string pkgJson = Path.Combine(m_projectRoot, "package.json");
            string pkgLock = Path.Combine(m_projectRoot, "package-lock.json");
            string nodeModules = Path.Combine(m_projectRoot, "node_modules");

            string currentHash = ComputeFileHash(pkgJson) + "_" + ComputeFileHash(pkgLock);
            string savedHash = "";
            if (File.Exists(m_depsHashPath))
            {
                try { savedHash = File.ReadAllText(m_depsHashPath).Trim(); } catch {}
            }
            else if (Directory.Exists(nodeModules))
            {
                try { File.WriteAllText(m_depsHashPath, currentHash); } catch {}
                savedHash = currentHash;
            }

            bool needsInstall = !Directory.Exists(nodeModules) || (currentHash != savedHash);
            if (!needsInstall)
            {
                Log("[Dependencies] node_modules present and manifest hash matches. Skipping install.");
                return true;
            }

            Log("[Dependencies] Manifest changed or node_modules missing. Running npm install...");
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c npm install");
            psi.WorkingDirectory = m_projectRoot;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            Process p = Process.Start(psi);
            if (m_hJob != IntPtr.Zero) JobObject.AssignProcessToJobObject(m_hJob, p.Handle);

            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs ea) {
                if (!string.IsNullOrEmpty(ea.Data)) Log(ea.Data);
            };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs ea) {
                if (!string.IsNullOrEmpty(ea.Data)) Log(ea.Data);
            };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();

            if (p.ExitCode == 0)
            {
                LogSuccess("[Dependencies] npm install completed successfully.");
                // Update stamp after install
                string newHash = ComputeFileHash(pkgJson) + "_" + ComputeFileHash(pkgLock);
                try { File.WriteAllText(m_depsHashPath, newHash); } catch {}
                return true;
            }
            else
            {
                LogError(string.Format("[Dependencies] npm install failed with exit code {0}", p.ExitCode));
                return false;
            }
        }

        private void ClearStalePorts()
        {
            int[] ports = new int[] { WEB_PORT, SERVER_PORT };
            for (int i = 0; i < ports.Length; i++)
            {
                int port = ports[i];
                List<int> pids = PortManager.GetPidsForPort(port);
                foreach (int pid in pids)
                {
                    try
                    {
                        Process proc = Process.GetProcessById(pid);
                        string name = proc.ProcessName.ToLowerInvariant();
                        if (name == "node" || name == "cmd" || name == "tsx" || name == "esbuild")
                        {
                            Log(string.Format("[Ports] Terminating stale project process {0} (PID {1}) on port {2}...", name, pid, port));
                            KillProcessTree(pid);
                        }
                        else
                        {
                            LogWarning(string.Format("[Ports] Port {0} is occupied by external application '{1}' (PID {2}). Leaving it alone.", port, name, pid));
                        }
                    }
                    catch {}
                }
            }
        }

        private void StartDevProcess()
        {
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c npm run dev");
            psi.WorkingDirectory = m_projectRoot;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.RedirectStandardInput = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            psi.EnvironmentVariables["BROWSER"] = "none";
            psi.EnvironmentVariables["NO_COLOR"] = "1";
            psi.EnvironmentVariables["CI"] = "1";
            psi.EnvironmentVariables["TERM"] = "dumb";
            psi.EnvironmentVariables["CM_STACK_OWNER"] = m_ownerTag;
            if (psi.EnvironmentVariables.ContainsKey("FORCE_COLOR"))
            {
                psi.EnvironmentVariables.Remove("FORCE_COLOR");
            }
            // The project keeps its data in the project folder, shared with the
            // desktop app; an inherited override would split the library again.
            if (psi.EnvironmentVariables.ContainsKey("CAPTION_MAKER_DATA_DIR"))
            {
                psi.EnvironmentVariables.Remove("CAPTION_MAKER_DATA_DIR");
            }

            m_devProcess = Process.Start(psi);
            if (m_hJob != IntPtr.Zero)
            {
                JobObject.AssignProcessToJobObject(m_hJob, m_devProcess.Handle);
            }

            try
            {
                m_devStdin = m_devProcess.StandardInput;
            }
            catch {}

            m_devProcess.OutputDataReceived += new DataReceivedEventHandler(OnDevOutput);
            m_devProcess.ErrorDataReceived += new DataReceivedEventHandler(OnDevOutput);
            m_devProcess.BeginOutputReadLine();
            m_devProcess.BeginErrorReadLine();

            m_devProcess.EnableRaisingEvents = true;
            m_devProcess.Exited += delegate(object s, EventArgs ea) {
                if (!m_isStopping && s == m_devProcess)
                {
                    SetStatus("Crashed", Color.FromArgb(239, 68, 68), "Dev server exited unexpectedly");
                    LogError("[Dev Server] Process exited unexpectedly.");
                }
            };
        }

        private void OnDevOutput(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            string text = CleanOutput(e.Data);
            if (string.IsNullOrEmpty(text)) return;

            if (text.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                LogError(text);
            }
            else if (text.IndexOf("warn", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                LogWarning(text);
            }
            else
            {
                Log(text);
            }
        }

        private bool WaitForReadiness(int timeoutSeconds)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
            while (DateTime.UtcNow < deadline && !m_isStopping)
            {
                bool apiOk = CheckEndpoint(string.Format("http://127.0.0.1:{0}/api/health", SERVER_PORT));
                bool webOk = CheckEndpoint(string.Format("http://127.0.0.1:{0}/", WEB_PORT));

                if (apiOk && webOk) return true;
                Thread.Sleep(400);
            }
            return false;
        }

        private bool CheckEndpoint(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1200;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode >= 200 && (int)res.StatusCode < 400;
                }
            }
            catch
            {
                return false;
            }
        }
        #endregion

        #region Cloudflare Tunnel Supervisor
        private void StartTunnelSupervisor()
        {
            if (!m_sharePublicLink || m_tunnelProcess != null) return;

            string cfPath = FindCloudflared();
            if (string.IsNullOrEmpty(cfPath))
            {
                UpdatePublicLinkUI("cloudflared not found", false);
                return;
            }

            // Authenticode verification
            if (!VerifyCloudflaredSignature(cfPath))
            {
                LogError("[Cloudflare] Signature verification failed for " + cfPath);
                UpdatePublicLinkUI("Untrusted binary", false);
                return;
            }

            UpdatePublicLinkUI("Starting tunnel...", false);
            Log("[Cloudflare] Starting quick tunnel to http://127.0.0.1:" + WEB_PORT + "...");

            ProcessStartInfo psi = new ProcessStartInfo(cfPath, string.Format("tunnel --no-autoupdate --url http://127.0.0.1:{0}", WEB_PORT));
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            m_tunnelProcess = Process.Start(psi);
            if (m_hJob != IntPtr.Zero)
            {
                JobObject.AssignProcessToJobObject(m_hJob, m_tunnelProcess.Handle);
            }

            m_tunnelProcess.ErrorDataReceived += new DataReceivedEventHandler(OnTunnelOutput);
            m_tunnelProcess.OutputDataReceived += new DataReceivedEventHandler(OnTunnelOutput);
            m_tunnelProcess.BeginErrorReadLine();
            m_tunnelProcess.BeginOutputReadLine();

            m_tunnelProcess.EnableRaisingEvents = true;
            m_tunnelProcess.Exited += delegate(object s, EventArgs ea) {
                if (s == m_tunnelProcess && !m_isStopping && m_sharePublicLink)
                {
                    m_tunnelProcess = null;
                    m_tunnelIsLive = false;
                    m_tunnelUrl = null;
                    UpdatePublicLinkUI("Tunnel disconnected", false);
                    ScheduleTunnelRestart();
                }
            };
        }

        private void OnTunnelOutput(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            string line = e.Data;

            // Regex to parse Cloudflare quick tunnel URL
            // Avoid matching api.trycloudflare.com
            Match match = Regex.Match(line, @"https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                m_tunnelUrl = match.Value;
                UpdatePublicLinkUI(m_tunnelUrl + " (connecting...)", false);
                Log("[Cloudflare] Assigned public URL: " + m_tunnelUrl);
            }

            if (line.IndexOf("Registered tunnel connection", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                m_tunnelIsLive = true;
                m_tunnelRestartAttempts = 0;
                UpdatePublicLinkUI(m_tunnelUrl, true);
                LogSuccess(string.Format("[Cloudflare] Public tunnel is LIVE at {0}", m_tunnelUrl));
                LogWarning("[Security Notice] Anyone with this link can access Caption Maker projects and tools until this launcher closes.");
            }

            // Only log WRN and ERR lines to keep pane clean
            if (line.IndexOf("ERR", StringComparison.OrdinalIgnoreCase) >= 0 || line.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                LogError("[Cloudflare] " + line);
            }
            else if (line.IndexOf("WRN", StringComparison.OrdinalIgnoreCase) >= 0 || line.IndexOf("warn", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                LogWarning("[Cloudflare] " + line);
            }
        }

        private void ScheduleTunnelRestart()
        {
            int[] delays = new int[] { 5, 10, 20, 40, 60 };
            int delaySec = delays[Math.Min(m_tunnelRestartAttempts, delays.Length - 1)];
            m_tunnelRestartAttempts++;

            LogWarning(string.Format("[Cloudflare] Reconnecting in {0}s... Note: A new public URL will be generated.", delaySec));
            ThreadPool.QueueUserWorkItem(delegate {
                Thread.Sleep(delaySec * 1000);
                if (!m_isStopping && m_sharePublicLink)
                {
                    StartTunnelSupervisor();
                }
            });
        }

        private void StopTunnel()
        {
            if (m_tunnelProcess != null)
            {
                try
                {
                    Log("[Cloudflare] Stopping tunnel...");
                    m_tunnelProcess.Kill();
                }
                catch {}
                m_tunnelProcess = null;
            }
            m_tunnelIsLive = false;
            m_tunnelUrl = null;
            UpdatePublicLinkUI("Tunnel stopped", false);
        }

        private void UpdatePublicLinkUI(string text, bool isLive)
        {
            if (this.IsDisposed || !this.IsHandleCreated) return;
            if (this.InvokeRequired)
            {
                try
                {
                    this.BeginInvoke(new Action(delegate { UpdatePublicLinkUI(text, isLive); }));
                }
                catch {}
                return;
            }

            m_lblPublicLink.Text = text;
            if (isLive)
            {
                m_lblPublicLink.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
                m_lblPublicStatus.Text = "(LIVE)";
                m_lblPublicStatus.ForeColor = Color.FromArgb(52, 211, 153);
                m_btnOpenPublic.Enabled = true;
                m_btnCopyPublic.Enabled = true;
            }
            else
            {
                m_lblPublicLink.ForeColor = Color.FromArgb(156, 163, 175);
                m_lblPublicStatus.Text = "(connecting / offline)";
                m_lblPublicStatus.ForeColor = Color.FromArgb(156, 163, 175);
                m_btnOpenPublic.Enabled = false;
                m_btnCopyPublic.Enabled = false;
            }
        }

        private bool VerifyCloudflaredSignature(string path)
        {
            try
            {
                X509Certificate cert = X509Certificate.CreateFromSignedFile(path);
                if (cert != null && cert.Subject.IndexOf("Cloudflare, Inc.", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            catch (Exception ex)
            {
                LogWarning("[Cloudflare] Signature check error: " + ex.Message);
            }
            return false;
        }

        private string FindCloudflared()
        {
            string[] candidates = new string[] {
                Path.Combine(m_projectRoot, "resources", "bin", "cloudflared.exe"),
                Path.Combine(m_projectRoot, "tools", "cloudflared.exe"),
                Path.Combine(m_projectRoot, "bin", "cloudflared.exe"),
                @"C:\Program Files (x86)\cloudflared\cloudflared.exe",
                @"C:\Program Files\cloudflared\cloudflared.exe"
            };

            for (int i = 0; i < candidates.Length; i++)
            {
                if (File.Exists(candidates[i])) return candidates[i];
            }

            // Check PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (pathEnv != null)
            {
                string[] parts = pathEnv.Split(';');
                for (int i = 0; i < parts.Length; i++)
                {
                    string candidate = Path.Combine(parts[i].Trim(), "cloudflared.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }

            // Check WinGet packages
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string wingetPath = Path.Combine(localAppData, @"Microsoft\WinGet\Packages");
            if (Directory.Exists(wingetPath))
            {
                try
                {
                    string[] matches = Directory.GetFiles(wingetPath, "cloudflared.exe", SearchOption.AllDirectories);
                    if (matches.Length > 0) return matches[0];
                }
                catch {}
            }

            return null;
        }

        private string FindFfmpeg()
        {
            string local = Path.Combine(m_projectRoot, "resources", "bin", "ffmpeg.exe");
            if (File.Exists(local)) return local;
            string res = RunCommandQuiet("ffmpeg", "-version");
            return string.IsNullOrEmpty(res) ? null : "ffmpeg (in PATH)";
        }
        #endregion

        #region File Watcher & Live Reload
        private void SetupWatcher()
        {
            try
            {
                m_watcher = new FileSystemWatcher(m_projectRoot);
                m_watcher.IncludeSubdirectories = true;
                m_watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName;

                m_watcher.Changed += new FileSystemEventHandler(OnFsEvent);
                m_watcher.Created += new FileSystemEventHandler(OnFsEvent);
                m_watcher.Deleted += new FileSystemEventHandler(OnFsEvent);
                m_watcher.Renamed += new RenamedEventHandler(OnFsRenamed);
                m_watcher.Error += new ErrorEventHandler(OnFsError);

                m_watcher.EnableRaisingEvents = true;
            }
            catch (Exception ex)
            {
                LogWarning("[Watcher] Could not initialize file watcher: " + ex.Message);
            }
        }

        private void OnFsEvent(object sender, FileSystemEventArgs e)
        {
            QueueChangeEvent(e.FullPath);
        }

        private void OnFsRenamed(object sender, RenamedEventArgs e)
        {
            QueueChangeEvent(e.FullPath);
        }

        private void OnFsError(object sender, ErrorEventArgs e)
        {
            LogWarning("[Watcher] Buffer overflow / error. Rechecking all manifests and env files...");
            QueueChangeEvent(Path.Combine(m_projectRoot, "package.json"));
            QueueChangeEvent(Path.Combine(m_projectRoot, ".env"));
        }

        private void QueueChangeEvent(string path)
        {
            if (IsIgnored(path)) return;

            lock (m_watcherLock)
            {
                if (!m_pendingChangedFiles.Contains(path))
                {
                    m_pendingChangedFiles.Add(path);
                }

                if (m_debounceTimer != null)
                {
                    m_debounceTimer.Dispose();
                }
                m_debounceTimer = new System.Threading.Timer(new TimerCallback(OnDebounceElapsed), null, 1500, Timeout.Infinite);
            }
        }

        private bool IsIgnored(string path)
        {
            string norm = path.Replace('/', '\\').ToLowerInvariant();
            if (norm.Contains("\\node_modules\\") ||
                norm.Contains("\\.git\\") ||
                norm.Contains("\\projects\\") ||
                norm.Contains("\\output\\") ||
                norm.Contains("\\fonts\\") ||
                norm.Contains("\\dist\\") ||
                norm.Contains("\\dist-server\\") ||
                norm.Contains("\\dist-electron\\") ||
                norm.Contains(".old-"))
            {
                return true;
            }
            if (norm.Contains("\\launcher\\") && !norm.EndsWith(".cs"))
            {
                return true;
            }
            return false;
        }

        private void OnDebounceElapsed(object state)
        {
            List<string> files;
            lock (m_watcherLock)
            {
                files = new List<string>(m_pendingChangedFiles);
                m_pendingChangedFiles.Clear();
            }

            if (files.Count == 0) return;

            bool manifestChanged = false;
            bool envChanged = false;
            bool launcherChanged = false;
            string sampleSrc = null;

            for (int i = 0; i < files.Count; i++)
            {
                string f = files[i];
                string name = Path.GetFileName(f).ToLowerInvariant();

                if (name == "package.json" || name == "package-lock.json")
                {
                    manifestChanged = true;
                }
                else if (name == ".env")
                {
                    envChanged = true;
                }
                else if (f.IndexOf("\\launcher\\", StringComparison.OrdinalIgnoreCase) >= 0 && f.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                {
                    launcherChanged = true;
                }
                else
                {
                    if (sampleSrc == null) sampleSrc = Path.GetFileName(f);
                }
            }

            if (launcherChanged)
            {
                this.BeginInvoke(new Action(delegate {
                    m_lblFooterCenter.Text = "Launcher source modified (will rebuild on next launch)";
                    m_lblFooterCenter.ForeColor = Color.FromArgb(59, 130, 246);
                }));
                Log("[Watcher] Launcher source file modified. It will automatically recompile on next launch.");
            }

            if (m_attached && (manifestChanged || envChanged))
            {
                // Not ours to restart: the desktop app restarts its own stack when
                // .env changes, and code changes hot-reload as usual.
                Log("[Watcher] " + (envChanged ? ".env" : "Dependencies manifest") + " modified. The stack belongs to " + DescribeOwner(m_attachedOwner) + ", so it is left for that app to reload.");
                return;
            }

            if (manifestChanged)
            {
                Log("[Watcher] Dependencies manifest modified.");
                ThreadPool.QueueUserWorkItem(delegate {
                    RestartWithDependenciesAsync();
                });
                return;
            }

            if (envChanged)
            {
                Log("[Watcher] .env configuration file modified. Restarting server to reload environment...");
                ThreadPool.QueueUserWorkItem(delegate {
                    RestartServersAsync();
                });
                return;
            }

            if (sampleSrc != null)
            {
                Log(string.Format("[Watcher] Source changed: {0} (hot-reloading via dev server)", sampleSrc));
            }
        }

        private void RestartWithDependenciesAsync()
        {
            SetStatus("Updating...", Color.FromArgb(245, 158, 11), "Manifest changed. Installing and restarting...");
            StopDevProcess();
            ClearStalePorts();
            EnsureDependencies();

            // npm install can take longer than the desktop app waits before it
            // starts a stack of its own; if it did, share that one rather than
            // clearing its ports.
            string running = ProbeCaptionMakerStack();
            if (running != null)
            {
                EnterAttachedMode(running);
                return;
            }

            ClearStalePorts();
            StartDevProcess();
            WaitForReadiness(40);
            SetStatus("Running", Color.FromArgb(16, 185, 129), "Web client and API server active");
        }
        #endregion

        #region Service Management
        private void OnStartRestartClick(object sender, EventArgs e)
        {
            if (m_isStopping)
            {
                m_isStopping = false;
                m_btnStartRestart.Text = "🔄 Restart";
                StartServersAsync();
            }
            else
            {
                RestartServersAsync();
            }
        }

        private void RestartServersAsync()
        {
            if (m_attached)
            {
                // Never restart another app's stack; look again instead, which
                // re-attaches if it is still up and starts our own if it is gone.
                Log("[Launcher] The stack belongs to " + DescribeOwner(m_attachedOwner) + "; checking it again instead of restarting it...");
                StartServersAsync();
                return;
            }

            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    SetStatus("Restarting...", Color.FromArgb(245, 158, 11), "Restarting dev server...");
                    Log("[Launcher] Restarting dev servers (public tunnel remains active)...");

                    StopDevProcess();
                    ClearStalePorts();
                    StartDevProcess();

                    bool ready = WaitForReadiness(35);
                    if (ready)
                    {
                        SetStatus("Running", Color.FromArgb(16, 185, 129), "Web client and API server active");
                        LogSuccess("[Launcher] Dev server restarted successfully.");
                    }
                    else
                    {
                        SetStatus("Error", Color.FromArgb(239, 68, 68), "Dev server failed to restart");
                    }
                }
                catch (Exception ex)
                {
                    SetStatus("Error", Color.FromArgb(239, 68, 68), ex.Message);
                    LogError("[Launcher] Restart error: " + ex.Message);
                }
            });
        }

        private void StopServers()
        {
            m_isStopping = true;
            SetStatus("Stopped", Color.FromArgb(107, 114, 128), "All services stopped");
            Log("[Launcher] Stopping all services...");

            StopDevProcess();
            StopTunnel();
            if (m_attached)
            {
                SetStatus("Stopped", Color.FromArgb(107, 114, 128), "Public link stopped; the stack keeps running for " + DescribeOwner(m_attachedOwner));
                Log("[Launcher] The stack was started by " + DescribeOwner(m_attachedOwner) + " and keeps running there.");
            }

            // One click handler switches on m_isStopping (an anonymous delegate
            // cannot be unsubscribed, so swapping handlers left both attached).
            m_btnStartRestart.Text = "▶ Start";
        }

        private void StopDevProcess()
        {
            if (m_devStdin != null)
            {
                try { m_devStdin.Close(); } catch {}
                m_devStdin = null;
            }
            if (m_devProcess != null)
            {
                try
                {
                    KillProcessTree(m_devProcess.Id);
                }
                catch {}
                m_devProcess = null;
            }
        }

        private void KillProcessTree(int pid)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill", string.Format("/PID {0} /T /F", pid));
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process p = Process.Start(psi);
                if (p != null) p.WaitForExit(3000);
            }
            catch {}
        }
        #endregion

        #region Polling & Health
        private void OnPollTimerTick(object sender, EventArgs e)
        {
            CheckPendingCommand();

            if (m_isStopping) return;
            if (m_attached)
            {
                ThreadPool.QueueUserWorkItem(delegate { CheckAttachedStack(); });
                return;
            }
            if (m_devProcess == null) return;

            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    bool apiOk = CheckEndpoint(string.Format("http://127.0.0.1:{0}/api/health", SERVER_PORT));
                    bool webOk = CheckEndpoint(string.Format("http://127.0.0.1:{0}/", WEB_PORT));

                    if (this.IsDisposed || !this.IsHandleCreated) return;

                    this.BeginInvoke(new Action(delegate {
                        try
                        {
                            if (this.IsDisposed) return;
                            if (apiOk && webOk)
                            {
                                if (m_lblStatusText.Text == "Not Responding")
                                {
                                    SetStatus("Running", Color.FromArgb(16, 185, 129), "Web client and API server active");
                                }
                            }
                            else
                            {
                                if (m_lblStatusText.Text == "Running")
                                {
                                    SetStatus("Not Responding", Color.FromArgb(245, 158, 11), "One or more services not answering");
                                }
                            }
                        }
                        catch {}
                    }));
                }
                catch {}
            });
        }

        /// <summary>
        /// Watches a stack another app owns. If that app closes and takes the stack
        /// with it, start our own after a pause, so the links (and the public URL,
        /// whose tunnel keeps running) carry on working. The pause and the free-port
        /// check keep this from racing the owner's own restart.
        /// </summary>
        private void CheckAttachedStack()
        {
            if (Interlocked.CompareExchange(ref m_attachedCheckBusy, 1, 0) != 0) return;
            try
            {
                if (!m_attached || m_isStopping) return;

                string health = ProbeCaptionMakerStack();
                if (health != null)
                {
                    if (m_attachedDownSinceUtc != DateTime.MinValue)
                    {
                        LogSuccess("[Launcher] The shared stack is answering again.");
                        SetStatus("Running", Color.FromArgb(16, 185, 129), "Sharing the stack started by " + DescribeOwner(m_attachedOwner));
                    }
                    m_attachedDownSinceUtc = DateTime.MinValue;
                    m_attachedOwner = HealthField(health, "owner") ?? m_attachedOwner;
                    return;
                }

                if (m_attachedDownSinceUtc == DateTime.MinValue)
                {
                    m_attachedDownSinceUtc = DateTime.UtcNow;
                    SetStatus("Not Responding", Color.FromArgb(245, 158, 11), "The shared stack stopped answering");
                    LogWarning("[Launcher] The shared stack stopped answering.");
                    return;
                }

                if ((DateTime.UtcNow - m_attachedDownSinceUtc).TotalSeconds < TAKEOVER_AFTER_SECONDS) return;
                if (PortsBusy()) return;

                LogWarning("[Launcher] " + DescribeOwner(m_attachedOwner) + " has closed and its stack with it. Starting one here so the links keep working...");
                m_attached = false;
                m_attachedDownSinceUtc = DateTime.MinValue;
                StartServersAsync();
            }
            catch (Exception ex)
            {
                LogError("[Launcher] Shared stack check failed: " + ex.Message);
            }
            finally
            {
                Interlocked.Exchange(ref m_attachedCheckBusy, 0);
            }
        }

        private void CheckPendingCommand()
        {
            try
            {
                string cmdFile = Path.Combine(m_launcherDir, "command.txt");
                if (File.Exists(cmdFile))
                {
                    string content = File.ReadAllText(cmdFile).Trim();
                    try { File.Delete(cmdFile); } catch {}
                    ExecuteCommand(content);
                }
            }
            catch {}
        }

        private void ExecuteCommand(string content)
        {
            string[] lines = content.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (string.IsNullOrEmpty(line)) continue;

                if (line.StartsWith("screenshot ", StringComparison.OrdinalIgnoreCase))
                {
                    string path = line.Substring(11).Trim().Trim('"');
                    CaptureWindow(path);
                }
                else if (line.Equals("toggle_public false", StringComparison.OrdinalIgnoreCase) || line.Equals("toggle_public 0", StringComparison.OrdinalIgnoreCase))
                {
                    m_chkSharePublic.Checked = false;
                }
                else if (line.Equals("toggle_public true", StringComparison.OrdinalIgnoreCase) || line.Equals("toggle_public 1", StringComparison.OrdinalIgnoreCase))
                {
                    m_chkSharePublic.Checked = true;
                }
                else if (line.Equals("restart", StringComparison.OrdinalIgnoreCase))
                {
                    RestartServersAsync();
                }
                else if (line.Equals("stop", StringComparison.OrdinalIgnoreCase))
                {
                    StopServers();
                }
                else if (line.Equals("exit", StringComparison.OrdinalIgnoreCase) || line.Equals("close", StringComparison.OrdinalIgnoreCase))
                {
                    this.Close();
                }
                else if (line.Equals("rebuild", StringComparison.OrdinalIgnoreCase))
                {
                    TriggerSelfRebuild();
                }
            }
        }

        public void CaptureWindow(string outputPath)
        {
            try
            {
                this.PerformLayout();
                this.Update();

                int w = this.Width > 0 ? this.Width : 980;
                int h = this.Height > 0 ? this.Height : 720;
                using (Bitmap bmp = new Bitmap(w, h))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(this.BackColor);

                        this.DrawToBitmap(bmp, new Rectangle(0, 0, w, h));

                        if (m_rtbLogs != null && m_rtbLogs.Visible)
                        {
                            Control current = m_rtbLogs;
                            int absX = 0;
                            int absY = 0;
                            while (current != null && current != this)
                            {
                                absX += current.Left;
                                absY += current.Top;
                                current = current.Parent;
                            }

                            int borderX = (this.Width - this.ClientSize.Width) / 2;
                            int borderY = (this.Height - this.ClientSize.Height) - borderX;
                            Rectangle rtbBounds = new Rectangle(absX + borderX, absY + borderY, m_rtbLogs.Width, m_rtbLogs.Height);

                            using (SolidBrush bgBrush = new SolidBrush(m_rtbLogs.BackColor))
                            {
                                g.FillRectangle(bgBrush, rtbBounds);
                            }

                            string[] logLines = m_rtbLogs.Lines;
                            if (logLines != null && logLines.Length > 0)
                            {
                                using (Font logFont = new Font("Consolas", 9.5F))
                                using (SolidBrush textBrush = new SolidBrush(Color.FromArgb(226, 232, 240)))
                                using (SolidBrush greenBrush = new SolidBrush(Color.FromArgb(52, 211, 153)))
                                using (SolidBrush amberBrush = new SolidBrush(Color.FromArgb(251, 191, 36)))
                                using (SolidBrush redBrush = new SolidBrush(Color.FromArgb(248, 113, 113)))
                                using (SolidBrush cyanBrush = new SolidBrush(Color.FromArgb(56, 189, 248)))
                                {
                                    int lineHeight = (int)g.MeasureString("Ag", logFont).Height + 2;
                                    int visibleLinesCount = Math.Max(1, rtbBounds.Height / lineHeight);
                                    int startLine = Math.Max(0, logLines.Length - visibleLinesCount);

                                    int y = rtbBounds.Y + 6;
                                    for (int i = startLine; i < logLines.Length && y < rtbBounds.Bottom - lineHeight; i++)
                                    {
                                        string l = logLines[i];
                                        Brush b = textBrush;
                                        if (l.Contains("[Success]") || l.Contains("ready") || l.Contains("LIVE")) b = greenBrush;
                                        else if (l.Contains("[Warning]") || l.Contains("WARN") || l.Contains("Restarting")) b = amberBrush;
                                        else if (l.Contains("[Error]") || l.Contains("ERR") || l.Contains("Failed")) b = redBrush;
                                        else if (l.Contains("[Watcher]") || l.Contains("[Cloudflare]")) b = cyanBrush;

                                        g.DrawString(l, logFont, b, new RectangleF(rtbBounds.X + 8, y, rtbBounds.Width - 16, lineHeight));
                                        y += lineHeight;
                                    }
                                }
                            }
                        }
                    }

                    string dir = Path.GetDirectoryName(outputPath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    {
                        Directory.CreateDirectory(dir);
                    }
                    bmp.Save(outputPath, System.Drawing.Imaging.ImageFormat.Png);
                    Log("[Launcher] Window screenshot saved to: " + outputPath);
                }
            }
            catch (Exception ex)
            {
                LogError("[Launcher] Screenshot failed: " + ex.Message);
            }
        }

        private void TriggerSelfRebuild()
        {
            Log("[Launcher] Triggering self-rebuild and restart...");
            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    string exePath = Assembly.GetEntryAssembly().Location;
                    string csFile = Path.Combine(m_launcherDir, "Launcher.cs");
                    File.SetLastWriteTimeUtc(csFile, DateTime.UtcNow.AddSeconds(5));

                    this.BeginInvoke(new Action(delegate {
                        this.Close();
                        Process.Start(exePath);
                    }));
                }
                catch (Exception ex)
                {
                    LogError("[Launcher] Rebuild trigger error: " + ex.Message);
                }
            });
        }
        #endregion

        #region UI Handlers & Helpers
        private void OnSharePublicChanged(object sender, EventArgs e)
        {
            m_sharePublicLink = m_chkSharePublic.Checked;
            SaveState();

            if (m_sharePublicLink)
            {
                Log("[Launcher] Public sharing enabled. Starting tunnel...");
                StartTunnelSupervisor();
            }
            else
            {
                Log("[Launcher] Public sharing disabled. Stopping tunnel...");
                StopTunnel();
            }
        }

        private void CopyToClipboard(string text)
        {
            try
            {
                if (!string.IsNullOrEmpty(text))
                {
                    Clipboard.SetText(text);
                    Log(string.Format("[Clipboard] Copied: {0}", text));
                }
            }
            catch {}
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                LogError("[Browser] Failed to open URL: " + ex.Message);
            }
        }

        private void OpenLogFile()
        {
            try
            {
                if (File.Exists(m_logPath))
                {
                    Process.Start(new ProcessStartInfo(m_logPath) { UseShellExecute = true });
                }
            }
            catch {}
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            m_isStopping = true;
            if (m_pollTimer != null) m_pollTimer.Stop();
            if (m_watcher != null) m_watcher.EnableRaisingEvents = false;

            SetStatus("Closing...", Color.FromArgb(239, 68, 68), "Shutting down processes and tunnels...");
            if (m_attached)
            {
                Log("[Launcher] Window closing. Stopping the public link; the stack keeps running for " + DescribeOwner(m_attachedOwner) + ".");
            }
            else
            {
                Log("[Launcher] Window closing. Terminating all processes...");
            }

            StopTunnel();
            StopDevProcess();

            if (m_hJob != IntPtr.Zero)
            {
                JobObject.CloseHandle(m_hJob);
                m_hJob = IntPtr.Zero;
            }
        }

        private void Log(string message)
        {
            AppendLogLine(message, Color.FromArgb(226, 232, 240));
        }

        private void LogSuccess(string message)
        {
            AppendLogLine(message, Color.FromArgb(52, 211, 153));
        }

        private void LogWarning(string message)
        {
            AppendLogLine(message, Color.FromArgb(251, 191, 36));
        }

        private void LogError(string message)
        {
            AppendLogLine(message, Color.FromArgb(248, 113, 113));
        }

        private void AppendLogLine(string message, Color color)
        {
            if (this.IsDisposed || !this.IsHandleCreated)
            {
                WriteLogFile(string.Format("[{0}] {1}\r\n", DateTime.Now.ToString("HH:mm:ss"), message));
                return;
            }
            if (this.InvokeRequired)
            {
                try
                {
                    this.BeginInvoke(new Action(delegate { AppendLogLine(message, color); }));
                }
                catch {}
                return;
            }

            string timestamp = DateTime.Now.ToString("HH:mm:ss");
            string line = string.Format("[{0}] {1}\r\n", timestamp, message);

            // Cap logs at 3000 lines
            if (m_rtbLogs.Lines.Length > 3000)
            {
                string[] lines = m_rtbLogs.Lines;
                string[] trimmed = new string[2000];
                Array.Copy(lines, lines.Length - 2000, trimmed, 0, 2000);
                m_rtbLogs.Lines = trimmed;
            }

            // Check if user is scrolled to bottom
            bool atBottom = m_rtbLogs.SelectionStart >= m_rtbLogs.TextLength - 2;

            m_rtbLogs.SelectionStart = m_rtbLogs.TextLength;
            m_rtbLogs.SelectionLength = 0;
            m_rtbLogs.SelectionColor = color;
            m_rtbLogs.AppendText(line);

            if (atBottom)
            {
                m_rtbLogs.ScrollToCaret();
            }

            // Write to log file (UTF-8 with BOM, rotating if > 5MB)
            WriteLogFile(line);
        }

        private void WriteLogFile(string text)
        {
            try
            {
                FileInfo fi = new FileInfo(m_logPath);
                if (fi.Exists && fi.Length > 5 * 1024 * 1024)
                {
                    string oldLog = m_logPath + ".old";
                    File.Delete(oldLog);
                    File.Move(m_logPath, oldLog);
                }
                File.AppendAllText(m_logPath, text, new UTF8Encoding(true));
            }
            catch {}
        }

        private string CleanOutput(string input)
        {
            if (string.IsNullOrEmpty(input)) return "";
            // Strip ANSI codes
            string stripped = Regex.Replace(input, @"\x1B\[[0-9;]*[a-zA-Z]", "");
            // Handle bare \r
            int rIdx = stripped.LastIndexOf('\r');
            if (rIdx >= 0 && rIdx < stripped.Length - 1)
            {
                stripped = stripped.Substring(rIdx + 1);
            }
            return stripped.Trim();
        }

        private string RunCommandQuiet(string cmd, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(cmd, args);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                Process p = Process.Start(psi);
                string outText = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode == 0 ? outText : null;
            }
            catch
            {
                return null;
            }
        }

        private string ComputeFileHash(string file)
        {
            if (!File.Exists(file)) return "none";
            try
            {
                using (SHA256 sha = SHA256.Create())
                using (FileStream fs = File.OpenRead(file))
                {
                    byte[] bytes = sha.ComputeHash(fs);
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < bytes.Length; i++)
                    {
                        sb.Append(bytes[i].ToString("x2"));
                    }
                    return sb.ToString();
                }
            }
            catch
            {
                return "err";
            }
        }

        private string GetActiveLanIp()
        {
            try
            {
                NetworkInterface[] interfaces = NetworkInterface.GetAllNetworkInterfaces();
                for (int i = 0; i < interfaces.Length; i++)
                {
                    NetworkInterface ni = interfaces[i];
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                    string desc = ni.Description.ToLowerInvariant();
                    string name = ni.Name.ToLowerInvariant();
                    if (desc.Contains("virtual") || desc.Contains("hyper-v") || desc.Contains("wsl") ||
                        desc.Contains("vmware") || desc.Contains("vpn") || desc.Contains("bluetooth") ||
                        name.Contains("vethernet") || desc.Contains("tap-windows"))
                    {
                        continue;
                    }

                    IPInterfaceProperties props = ni.GetIPProperties();
                    if (props.GatewayAddresses.Count == 0) continue;

                    bool hasDefaultGateway = false;
                    for (int g = 0; g < props.GatewayAddresses.Count; g++)
                    {
                        GatewayIPAddressInformation gw = props.GatewayAddresses[g];
                        if (gw.Address != null && gw.Address.AddressFamily == AddressFamily.InterNetwork && !gw.Address.Equals(IPAddress.Any))
                        {
                            hasDefaultGateway = true;
                            break;
                        }
                    }
                    if (!hasDefaultGateway) continue;

                    for (int u = 0; u < props.UnicastAddresses.Count; u++)
                    {
                        UnicastIPAddressInformation uni = props.UnicastAddresses[u];
                        if (uni.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(uni.Address))
                        {
                            return uni.Address.ToString();
                        }
                    }
                }
            }
            catch {}
            return "127.0.0.1";
        }

        private void LoadState()
        {
            if (File.Exists(m_statePath))
            {
                try
                {
                    string json = File.ReadAllText(m_statePath);
                    if (json.Contains("\"sharePublicLink\": false") || json.Contains("\"sharePublicLink\":false"))
                    {
                        m_sharePublicLink = false;
                    }
                }
                catch {}
            }
        }

        private void SaveState()
        {
            try
            {
                string json = string.Format("{{\"sharePublicLink\": {0}}}", m_sharePublicLink ? "true" : "false");
                File.WriteAllText(m_statePath, json);
            }
            catch {}
        }
        #endregion
    }
}
