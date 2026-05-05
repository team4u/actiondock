package org.team4u.actiondock.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.skill.GithubSkillCollectionService;
import org.team4u.actiondock.skill.SkillService;
import org.team4u.actiondock.skill.SkillTargetService;

/**
 * 技能相关配置，注册技能服务、技能目标服务和 GitHub 技能集合服务等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class SkillConfiguration {

    @Bean
    public SkillService skillService(SkillTargetRepository skillTargetRepository,
                                     ManagedSkillRepository managedSkillRepository,
                                     SkillInstallationRepository skillInstallationRepository,
                                     JsonCodec jsonCodec,
                                     AppProperties properties) {
        return new SkillService(skillTargetRepository, managedSkillRepository, skillInstallationRepository, jsonCodec, properties);
    }

    @Bean
    public SkillTargetService skillTargetService(SkillTargetRepository skillTargetRepository,
                                                  SkillInstallationRepository skillInstallationRepository,
                                                  SkillService skillService) {
        return new SkillTargetService(skillTargetRepository, skillInstallationRepository, skillService);
    }

    @Bean
    public GithubSkillCollectionService githubSkillCollectionService(SkillService skillService, JsonCodec jsonCodec) {
        return new GithubSkillCollectionService(skillService, jsonCodec);
    }
}
