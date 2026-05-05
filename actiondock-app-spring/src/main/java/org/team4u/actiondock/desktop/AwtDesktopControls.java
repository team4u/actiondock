package org.team4u.actiondock.desktop;

import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import javax.swing.WindowConstants;
import java.awt.AWTException;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.GraphicsEnvironment;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.RenderingHints;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.awt.image.BufferedImage;
import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * AWT/Swing desktop control surface for GUI launches.
 */
public class AwtDesktopControls implements DesktopControls {
    private static final Logger LOGGER = Logger.getLogger(AwtDesktopControls.class.getName());

    @Override
    public DesktopControl show(URI adminUri, Runnable openAction, Runnable quitAction) {
        if (GraphicsEnvironment.isHeadless()) {
            LOGGER.warning("Desktop controls are unavailable in a headless environment");
            return DesktopControl.NOOP;
        }

        CountDownLatch exitLatch = new CountDownLatch(1);
        Runnable exit = () -> {
            try {
                quitAction.run();
            } finally {
                exitLatch.countDown();
            }
        };

        if (SystemTray.isSupported()) {
            try {
                return showTray(openAction, exit, exitLatch);
            } catch (AWTException | RuntimeException ex) {
                LOGGER.log(Level.WARNING, "Unable to create system tray icon", ex);
            }
        }

        return showFallbackWindow(adminUri, openAction, exit, exitLatch);
    }

    private DesktopControl showTray(Runnable openAction, Runnable exit, CountDownLatch exitLatch) throws AWTException {
        SystemTray tray = SystemTray.getSystemTray();
        PopupMenu menu = new PopupMenu();
        MenuItem openItem = new MenuItem("Open Admin Console");
        MenuItem quitItem = new MenuItem("Quit ActionDock");
        TrayIcon trayIcon = new TrayIcon(createTrayImage(), "ActionDock", menu);

        openItem.addActionListener(event -> openAction.run());
        quitItem.addActionListener(event -> {
            tray.remove(trayIcon);
            exit.run();
        });
        trayIcon.addActionListener(event -> openAction.run());

        menu.add(openItem);
        menu.addSeparator();
        menu.add(quitItem);
        trayIcon.setImageAutoSize(true);
        tray.add(trayIcon);

        return awaitLatch(exitLatch);
    }

    private static DesktopControl awaitLatch(CountDownLatch exitLatch) {
        return () -> {
            try {
                exitLatch.await();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        };
    }

    private DesktopControl showFallbackWindow(
            URI adminUri,
            Runnable openAction,
            Runnable exit,
            CountDownLatch exitLatch
    ) {
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("ActionDock");
            JButton openButton = new JButton("Open Admin Console");
            JButton quitButton = new JButton("Quit ActionDock");
            JPanel actions = new JPanel();
            actions.add(openButton);
            actions.add(quitButton);

            openButton.addActionListener(event -> openAction.run());
            quitButton.addActionListener(event -> {
                frame.dispose();
                exit.run();
            });
            frame.addWindowListener(new WindowAdapter() {
                @Override
                public void windowClosing(WindowEvent event) {
                    exit.run();
                }
            });

            frame.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
            frame.setLayout(new BorderLayout(12, 12));
            frame.add(new JLabel("ActionDock is running at " + adminUri), BorderLayout.CENTER);
            frame.add(actions, BorderLayout.SOUTH);
            frame.setSize(460, 140);
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
        });

        return awaitLatch(exitLatch);
    }

    private Image createTrayImage() {
        int size = 32;
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setColor(new Color(18, 74, 94));
            graphics.fillRoundRect(2, 2, size - 4, size - 4, 8, 8);
            graphics.setColor(Color.WHITE);
            graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 11));
            graphics.drawString("AD", 8, 21);
        } finally {
            graphics.dispose();
        }
        return image;
    }
}
