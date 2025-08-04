module.exports = {
    apps: [
        {
            name: "whatsapp-api",
            script: "whatsapp-api.js",
            interpreter: "node",
            autorestart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true,
            autostart: true
        },
        {
            name: "alert_Camp",
            script: "PM2/Checkpoint_Camp/checkalert_Camp.cjs",
            cron_restart: "1-59 * * * *",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        },
        {
            name: "alert_SP3",
            script: "PM2/Checkpoint_SP3/checkalert_SP3.cjs",
            cron_restart: "1-59 * * * *",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        },
        {
            name: "checkpoint_Camp",
            script: "PM2/Checkpoint_Camp/checkpoint_Camp.cjs",
            cron_restart: "0 0,2,4,6,8,10,12,14,16,18,20,22 * * *",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        },
        {
            name: "clear_Camp",
            script: "PM2/Checkpoint_Camp/LimpaCache_Camp.cjs",
            cron_restart: "0 20 * * 0",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        },
        {
            name: "clear_SP3",
            script: "PM2/Checkpoint_SP3/LimpaCache_SP3.cjs",
            cron_restart: "0 20 * * 0",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        },
        {
            name: "clear_PC",
            script: "clear_pc.cjs",
            cron_restart: "0 22 * * 0",
            interpreter: "node",
            autorestart: false,
            autostart: true,
            watch: false,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            merge_logs: true
        }
    ],
    log_file: "./logs/combined.log",
    error_file: "./logs/combined-error.log"
};
