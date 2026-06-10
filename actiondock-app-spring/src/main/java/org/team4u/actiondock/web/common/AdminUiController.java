package org.team4u.actiondock.web.common;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 管理后台 UI 控制器，将前端路由统一转发到静态资源。
 *
 * @author jay.wu
 */
@Controller
public class AdminUiController {
    /**
     * 管理后台入口重定向。
     *
     * @return 重定向到 /admin/app
     */
    @GetMapping({"/admin", "/admin/"})
    public String redirect() {
        return "redirect:/admin/app";
    }

    /**
     * 管理后台 SPA 前端路由 Catch-All。
     *
     * @return 转发到 admin/index.html
     */
    @GetMapping({"/admin/app", "/admin/app/", "/admin/app/**"})
    public String index() {
        return "forward:/admin/index.html";
    }
}
