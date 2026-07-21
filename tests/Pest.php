<?php

use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature', 'Browser');
pest()->browser()->timeout(10_000);
