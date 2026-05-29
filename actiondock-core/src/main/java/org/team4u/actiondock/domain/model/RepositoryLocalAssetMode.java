package org.team4u.actiondock.domain.model;

/**
 * 仓库本地资产的版本管理模式。
 * <p>
 * 控制本地资产是否随上游版本自动更新。
 *
 * @author jay.wu
 */
public enum RepositoryLocalAssetMode {
    /** 锁定模式，资产版本固定，不随上游自动更新 */
    LOCKED,
    /** 追踪模式，资产版本跟随上游自动更新 */
    TRACKED
}
