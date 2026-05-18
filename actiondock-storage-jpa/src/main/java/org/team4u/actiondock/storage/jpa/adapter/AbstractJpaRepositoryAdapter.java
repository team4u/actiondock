package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.data.repository.CrudRepository;

import java.util.List;
import java.util.Optional;
import java.util.stream.StreamSupport;

/**
 * JPA 仓储适配器通用基类，提供标准 CRUD 操作的模板实现。
 * <p>
 * 子类只需实现 toEntity/toDomain 转换方法即可自动获得 save/findById/findAll/deleteById 能力。
 *
 * @param <E> JPA 实体类型
 * @param <D> 领域对象类型
 * @param <R> Spring Data 仓储接口类型
 * @author jay.wu
 */
public abstract class AbstractJpaRepositoryAdapter<E, D, R extends CrudRepository<E, String>> {

    protected final R repository;

    protected AbstractJpaRepositoryAdapter(R repository) {
        this.repository = repository;
    }

    public D save(D domain) {
        return toDomain(repository.save(toEntity(domain)));
    }

    public Optional<D> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    public List<D> findAll() {
        return StreamSupport.stream(repository.findAll().spliterator(), false)
                .map(this::toDomain).toList();
    }

    public void deleteById(String id) {
        repository.deleteById(id);
    }

    protected abstract E toEntity(D domain);

    protected abstract D toDomain(E entity);
}
